import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'opportunities_model.dart';

class OpportunitiesScreen extends StatelessWidget {
  const OpportunitiesScreen({super.key, required this.model});
  final OpportunitiesModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) => RefreshIndicator(
      onRefresh: model.load,
      child: ListView(
        key: const PageStorageKey('opportunities'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Opportunities',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          const Text(
            'Available opportunities from up to 200 open requests checked. This is not a complete catalogue.',
          ),
          const SizedBox(height: 12),
          const Text(
            'Read-only preview. Bidding and service-area changes are not available here.',
          ),
          if (model.status == OpportunitiesStatus.loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Loading opportunities',
                ),
              ),
            ),
          if (model.status == OpportunitiesStatus.failed) ...[
            const SizedBox(height: 20),
            Semantics(liveRegion: true, child: Text(model.message!)),
            OutlinedButton(onPressed: model.load, child: const Text('Retry')),
          ],
          if (model.status == OpportunitiesStatus.ready &&
              model.feed != null) ...[
            if (!model.feed!.eligible) ...[
              const SizedBox(height: 20),
              Text(
                'Opportunities unavailable',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                model.feed!.ineligibleReason?.trim().isNotEmpty == true
                    ? model.feed!.ineligibleReason!
                    : 'This account is not currently eligible for marketplace opportunities.',
              ),
            ] else if (model.feed!.items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No opportunities available in this feed.'),
              ),
            if (model.feed!.eligible)
              ...model.feed!.items.map(
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
                        Text(item.communityName),
                        Text(
                          '${item.context == 'hoa' ? 'HOA' : 'Neighborhood'} · ${item.category}',
                        ),
                        Text(
                          item.kind == 'compulsory_recurring'
                              ? 'Recurring community service'
                              : 'Optional group service',
                        ),
                        Text(
                          'Homes: ${item.homeCount} · Visits per home: ${item.totalOccurrences}',
                        ),
                        if (item.approximateDistanceMi != null)
                          Text(
                            'Approximate community distance: ${item.approximateDistanceMi} mi',
                          ),
                        Text(
                          'Bidding closes: ${item.biddingClosesAt == null ? 'Not provided' : localInstantLabel(context, item.biddingClosesAt!)}',
                        ),
                        OutlinedButton(
                          onPressed: () => model.toggleExpanded(item.requestId),
                          child: Text(
                            model.expandedId == item.requestId
                                ? 'Hide details'
                                : 'Show details',
                          ),
                        ),
                        if (model.expandedId == item.requestId) ...[
                          Text(item.description),
                          if (item.locality != null) Text(item.locality!),
                          if (item.region != null) Text(item.region!),
                          Text(
                            'Recurrence: ${item.recurrenceLabel ?? 'Not provided'}',
                          ),
                          Text(
                            'Starts: ${item.startDate == null ? 'Not provided' : localInstantLabel(context, item.startDate!)}',
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: model.load,
              child: const Text('Refresh opportunities'),
            ),
          ],
        ],
      ),
    ),
  );
}
