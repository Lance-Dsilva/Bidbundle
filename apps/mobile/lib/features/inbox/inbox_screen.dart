import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'inbox_model.dart';
import 'models.dart';

class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key, required this.model, this.detailView = false});
  final InboxModel model;
  final bool detailView;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final status = detailView ? model.detailStatus : model.listStatus;
      final retry = detailView ? model.refreshDetail : model.loadList;
      final detail = model.detail;
      return RefreshIndicator(
        onRefresh: retry,
        child: ListView(
          key: PageStorageKey(
            detailView ? 'conversation-${model.selectedId}' : 'inbox',
          ),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              detailView ? 'Conversation' : 'Inbox',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            const Text(
              'Read-only preview. Viewing does not mark messages read. Sending messages is not available here.',
            ),
            const SizedBox(height: 12),
            Text(
              detailView
                  ? 'Latest 50 messages, shown oldest first within this window.'
                  : 'Up to 100 recent conversations.',
            ),
            if (status == InboxStatus.loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(
                  child: CircularProgressIndicator(
                    semanticsLabel: 'Loading conversations',
                  ),
                ),
              ),
            if (status == InboxStatus.failed) ...[
              const SizedBox(height: 20),
              Semantics(
                liveRegion: true,
                child: Text(
                  (detailView ? model.detailMessage : model.listMessage)!,
                ),
              ),
              OutlinedButton(onPressed: retry, child: const Text('Retry')),
            ],
            if (status == InboxStatus.ready) ...[
              if (!detailView) ...[
                if (model.items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('No conversations available.'),
                  ),
                ...model.items.map(
                  (item) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _Thread(item),
                          if (item.lastMessagePreview != null) ...[
                            const SizedBox(height: 8),
                            const Text('Message preview'),
                            Text(
                              item.lastMessagePreview!,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                          if (item.lastMessageAt != null)
                            Text(
                              localInstantLabel(context, item.lastMessageAt!),
                            ),
                          OutlinedButton(
                            onPressed: () => model.openDetail(item.id),
                            child: const Text('View conversation'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ] else if (detail != null) ...[
                const SizedBox(height: 16),
                _Thread(detail.thread),
                if (detail.hasMore)
                  const Text(
                    'Older messages are not included in this preview.',
                  ),
                if (detail.messages.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('No messages in this conversation.'),
                  ),
                ...detail.messages.map(
                  (message) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            message.isMine ? 'You' : message.senderName,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(message.body),
                          const SizedBox(height: 12),
                          Text(localInstantLabel(context, message.createdAt)),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: retry,
                child: Text(
                  detailView ? 'Refresh conversation' : 'Refresh inbox',
                ),
              ),
            ],
          ],
        ),
      );
    },
  );
}

class _Thread extends StatelessWidget {
  const _Thread(this.thread);
  final InboxThread thread;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(thread.requestTitle, style: Theme.of(context).textTheme.titleLarge),
      Text(thread.communityName),
      Text(
        '${thread.otherPartyRole == 'provider' ? 'Provider' : 'Customer'}: ${thread.otherPartyName}',
      ),
    ],
  );
}
