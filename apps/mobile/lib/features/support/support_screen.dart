import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'models.dart';
import 'support_model.dart';

String supportStatusLabel(String status) => switch (status) {
  'new' => 'Received',
  'open' || 'pending_internal' => 'With our team',
  'pending_customer' => 'Waiting on requester',
  'resolved' => 'Resolved',
  'closed' => 'Closed',
  _ => 'Status unavailable',
};
String supportCategoryLabel(String category) => switch (category) {
  'account' => 'Account & sign-in',
  'billing' => 'Billing',
  'service_request' => 'Service request',
  'bidding' => 'Bids & awards',
  'scheduling' => 'Scheduling & visits',
  'provider_issue' => 'Provider issue',
  'community' => 'Community & HOA',
  'technical' => 'Technical help',
  _ => 'Other',
};

class SupportScreen extends StatelessWidget {
  const SupportScreen({
    super.key,
    required this.model,
    this.detailView = false,
  });
  final SupportModel model;
  final bool detailView;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) => detailView ? _detail(context) : _list(context),
  );
  Widget _list(BuildContext context) => RefreshIndicator(
    onRefresh: model.loadList,
    child: ListView(
      key: const PageStorageKey('support-list-scroll'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          'Support requests',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Up to 100 recent support requests available to this account, including authorized community tickets where applicable.',
        ),
        const SizedBox(height: 12),
        const Text(
          'Read-only preview. Creating, replying to and reopening tickets are not available here.',
        ),
        if (model.listStatus == SupportStatus.loading)
          const _Loading('Loading support requests'),
        if (model.listStatus == SupportStatus.failed)
          _Error(model.listMessage!, model.loadList),
        if (model.listStatus == SupportStatus.ready) ...[
          if (model.items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text('No support requests available.'),
            ),
          ...model.items.map(
            (item) => Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Summary(item),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: () => model.openDetail(item.id),
                      child: const Text('View conversation'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: model.loadList,
            child: const Text('Refresh support requests'),
          ),
        ],
      ],
    ),
  );
  Widget _detail(BuildContext context) {
    final detail = model.detail;
    return RefreshIndicator(
      onRefresh: model.refreshDetail,
      child: ListView(
        key: PageStorageKey('support-detail-scroll-${model.selectedId}'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Support conversation',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          if (model.detailStatus == SupportStatus.loading)
            const _Loading('Loading support conversation'),
          if (model.detailStatus == SupportStatus.failed)
            _Error(model.detailMessage!, model.refreshDetail),
          if (model.detailStatus == SupportStatus.ready && detail != null) ...[
            const SizedBox(height: 16),
            _Summary(detail),
            const SizedBox(height: 20),
            const Text('Visible messages'),
            if (detail.messages.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No visible messages in this conversation.'),
              ),
            ...detail.messages.map(
              (message) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(switch (message.authorSide) {
                        'you' => 'You',
                        'support' => 'Bundleen Support',
                        _ => 'Customer',
                      }, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text(message.body),
                      const SizedBox(height: 12),
                      Text(localInstantLabel(context, message.createdAt)),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Read-only conversation. Replies and related destinations are not available in this preview.',
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: model.refreshDetail,
              child: const Text('Refresh conversation'),
            ),
          ],
        ],
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary(this.ticket);
  final SupportTicketSummary ticket;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(ticket.ticketNumber, style: Theme.of(context).textTheme.labelLarge),
      const SizedBox(height: 8),
      Text(ticket.subject, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      Text(supportCategoryLabel(ticket.category)),
      Text(supportStatusLabel(ticket.status)),
      if (ticket.communityName != null) Text(ticket.communityName!),
      const SizedBox(height: 8),
      Text('Opened: ${localInstantLabel(context, ticket.createdAt)}'),
      Text(
        'Last activity: ${localInstantLabel(context, ticket.lastActivityAt)}',
      ),
    ],
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
  const _Error(this.message, this.retry);
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
