import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';

import 'requests_model.dart';

String usdCents(int cents) =>
    '\$${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')} USD';
String requestBudget(int? minimum, int? maximum) {
  if (minimum == null && maximum == null) return 'Not specified';
  if (minimum == null) return 'Up to ${usdCents(maximum!)}';
  if (maximum == null) return 'From ${usdCents(minimum)}';
  return minimum == maximum
      ? usdCents(minimum)
      : '${usdCents(minimum)} – ${usdCents(maximum)}';
}

String requestDateLabel(BuildContext context, DateTime? instant) {
  if (instant == null) return 'Not specified';
  final local = instant.toLocal();
  final labels = MaterialLocalizations.of(context);
  final offset = local.timeZoneOffset;
  final minutes = offset.inMinutes.abs();
  final zone =
      'UTC${offset.isNegative ? '-' : '+'}${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';
  return '${labels.formatMediumDate(local)}, ${labels.formatTimeOfDay(TimeOfDay.fromDateTime(local), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))} ($zone)';
}

/// Read-only content. All details come from the separately authorized GET.
class RequestsScreen extends StatelessWidget {
  const RequestsScreen({
    super.key,
    required this.model,
    this.detailView = false,
  });
  final RequestsModel model;
  final bool detailView;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) => detailView ? _detail(context) : _list(context),
  );
  Widget _list(BuildContext context) => ListView(
    key: const PageStorageKey('request-list-scroll'),
    padding: const EdgeInsets.all(24),
    children: [
      Text('Your requests', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 12),
      const Text(
        'Up to 100 recent requests. This preview supports browsing; request changes are not available here.',
      ),
      if (model.listStatus == RequestStatus.loading)
        const _Loading('Loading requests'),
      if (model.listStatus == RequestStatus.failed)
        _Error(message: model.listMessage!, retry: model.loadList),
      if (model.listStatus == RequestStatus.ready) ...[
        if (model.eligibilityMessage != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(model.eligibilityMessage!),
          ),
        if (model.items.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('No requests yet.'),
          ),
        ...model.items.map(
          (item) => Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(item.categoryLabel),
                  Text(item.communityName),
                  _CompactValue('Status', item.status.replaceAll('_', ' ')),
                  _CompactValue(
                    'Budget',
                    requestBudget(item.budgetMinCents, item.budgetMaxCents),
                  ),
                  _CompactValue('Recorded bids', '${item.bidCount}'),
                  _CompactValue(
                    'Lowest live bid',
                    item.bestBidCents == null
                        ? 'No live bid'
                        : usdCents(item.bestBidCents!),
                  ),
                  _CompactValue(
                    'Created',
                    requestDateLabel(context, item.createdAt),
                  ),
                  _CompactValue(
                    'Enrollment closes',
                    requestDateLabel(context, item.enrollmentClosesAt),
                  ),
                  const SizedBox(height: 12),
                  if (item.context == 'neighborhood')
                    OutlinedButton(
                      onPressed: () => model.openDetail(item.id),
                      child: const Text('View details'),
                    )
                  else
                    const Text(
                      'HOA request details are not available in this mobile preview.',
                    ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: model.loadList,
          child: const Text('Refresh requests'),
        ),
      ],
    ],
  );
  Widget _detail(BuildContext context) {
    final detail = model.detail;
    return ListView(
      key: PageStorageKey('request-detail-scroll-${model.selectedId}'),
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          'Request details',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        if (model.detailStatus == RequestStatus.loading)
          const _Loading('Loading request details'),
        if (model.detailStatus == RequestStatus.failed)
          _Error(message: model.detailMessage!, retry: model.refreshDetail),
        if (model.detailStatus == RequestStatus.ready && detail != null) ...[
          const SizedBox(height: 20),
          Text(detail.title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(detail.categoryLabel),
          Text(detail.communityName),
          _Value('Status', detail.status.replaceAll('_', ' ')),
          if (detail.description.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(detail.description),
            ),
          _Value(
            'Budget',
            requestBudget(detail.budgetMinCents, detail.budgetMaxCents),
          ),
          _Value('Joined homes', '${detail.joinedCount}'),
          _Value('Bids', '${detail.bidCount}'),
          _Value('Service occurrences', '${detail.totalOccurrences}'),
          _Value('Created', requestDateLabel(context, detail.createdAt)),
          _Value(
            'Enrollment closes',
            requestDateLabel(context, detail.enrollmentClosesAt),
          ),
          _Value(
            'Bidding closes',
            requestDateLabel(context, detail.biddingClosesAt),
          ),
          _Value('Start date', requestDateLabel(context, detail.startDate)),
          const SizedBox(height: 20),
          const Text(
            'Read-only overview. Participation, bids, scheduling and request changes are not available in this preview.',
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: model.refreshDetail,
            child: const Text('Refresh details'),
          ),
        ],
      ],
    );
  }
}

class _CompactValue extends StatelessWidget {
  const _CompactValue(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$label: ',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          TextSpan(text: value),
        ],
      ),
    ),
  );
}

class _Value extends StatelessWidget {
  const _Value(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelLarge),
        Text(value),
      ],
    ),
  );
}

class _Loading extends StatelessWidget {
  const _Loading(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(32),
    child: Center(child: CircularProgressIndicator(semanticsLabel: label)),
  );
}

class _Error extends StatelessWidget {
  const _Error({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(liveRegion: true, child: Text(message)),
        const SizedBox(height: 16),
        OutlinedButton(onPressed: retry, child: const Text('Retry')),
      ],
    ),
  );
}

/// Actual nested routes preserve platform detail transitions and iOS edge-back.
/// Removing the parent on session invalidation also removes the entire stack.
class RequestsNavigator extends StatelessWidget {
  const RequestsNavigator({super.key, required this.model});
  final RequestsModel model;
  @override
  Widget build(BuildContext context) {
    final selected = model.selectedId;
    Page<void> page({required LocalKey key, required bool detail}) {
      final content = Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: RequestsScreen(model: model, detailView: detail),
      );
      return Theme.of(context).platform == TargetPlatform.iOS
          ? CupertinoPage<void>(key: key, child: content)
          : MaterialPage<void>(key: key, child: content);
    }

    return NavigatorPopHandler<void>(
      enabled: selected != null,
      onPopWithResult: (_) => model.closeDetail(),
      child: Navigator(
        pages: [
          page(key: const ValueKey('requests-list'), detail: false),
          if (selected != null)
            page(key: ValueKey('request-$selected'), detail: true),
        ],
        onDidRemovePage: (removed) {
          if (model.selectedId != null &&
              removed.key == ValueKey('request-${model.selectedId}')) {
            model.closeDetail();
          }
        },
      ),
    );
  }
}
