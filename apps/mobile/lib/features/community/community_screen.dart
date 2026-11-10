import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'community_model.dart';

class CommunityScreen extends StatelessWidget {
  const CommunityScreen({super.key, required this.model});
  final CommunityModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final hub = model.hub;
      return RefreshIndicator(
        onRefresh: model.load,
        child: ListView(
          key: const PageStorageKey('community'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'Community',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            const Text(
              'Read-only snapshot. Joining, responding and community management are not available in this preview.',
            ),
            if (model.status == CommunityStatus.loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(
                  child: CircularProgressIndicator(
                    semanticsLabel: 'Loading neighborhood',
                  ),
                ),
              ),
            if (model.status == CommunityStatus.failed) ...[
              const SizedBox(height: 20),
              Semantics(liveRegion: true, child: Text(model.message!)),
              OutlinedButton(onPressed: model.load, child: const Text('Retry')),
            ],
            if (model.status == CommunityStatus.ready) ...[
              const SizedBox(height: 20),
              if (hub == null)
                const Text(
                  'No active neighborhood is available to this account.',
                )
              else ...[
                Text(
                  hub.communityName,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(
                  'Active members: ${hub.activeNeighbourCount} (includes you)',
                ),
                if (hub.managerName != null)
                  Text('Assigned manager: ${hub.managerName}'),
                const SizedBox(height: 16),
                const Text('Up to 50 recent visible requests'),
                if (hub.requests.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Text('No visible requests in this neighborhood.'),
                  ),
                ...hub.requests.map(
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
                          Text(item.categoryLabel),
                          Text('Status: ${item.status.replaceAll('_', ' ')}'),
                          Text(
                            'Created: ${localInstantLabel(context, item.createdAt)}',
                          ),
                          OutlinedButton(
                            onPressed: () => model.toggleExpanded(item.id),
                            child: Text(
                              model.expandedId == item.id
                                  ? 'Hide description'
                                  : 'Show description',
                            ),
                          ),
                          if (model.expandedId == item.id)
                            Text(item.description),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: model.load,
                child: const Text('Refresh neighborhood'),
              ),
            ],
          ],
        ),
      );
    },
  );
}
