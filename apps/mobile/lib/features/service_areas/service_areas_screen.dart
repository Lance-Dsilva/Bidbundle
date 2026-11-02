import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'service_areas_model.dart';

class ServiceAreasScreen extends StatelessWidget {
  const ServiceAreasScreen({super.key, required this.model});
  final ServiceAreasModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) => RefreshIndicator(
      onRefresh: model.load,
      child: ListView(
        key: const PageStorageKey('service-areas'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Service areas',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          const Text(
            'Saved coverage is one input to opportunity matching. It does not confirm account activation, verified credentials or bidding access.',
          ),
          const SizedBox(height: 12),
          const Text(
            'Read-only summary. Coverage changes are not available in this preview.',
          ),
          if (model.status == ServiceAreasStatus.loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Loading service areas',
                ),
              ),
            ),
          if (model.status == ServiceAreasStatus.failed) ...[
            const SizedBox(height: 20),
            Semantics(liveRegion: true, child: Text(model.message!)),
            OutlinedButton(onPressed: model.load, child: const Text('Retry')),
          ],
          if (model.status == ServiceAreasStatus.ready) ...[
            if (model.items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No saved active service areas.'),
              ),
            ...model.items.map(
              (item) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.label,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      if (item.isPrimary) const Text('Primary service area'),
                      if (item.locality != null) Text(item.locality!),
                      if (item.region != null) Text(item.region!),
                      Text(
                        item.radiusMiles == null
                            ? 'Radius not provided'
                            : 'Saved radius: ${item.radiusMiles} mi',
                      ),
                      if (item.postalCodes.isNotEmpty)
                        Text(
                          'Saved postal coverage: ${item.postalCodes.join(', ')}',
                        ),
                      Text(
                        'Updated: ${localInstantLabel(context, item.updatedAt)}',
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: model.load,
              child: const Text('Refresh service areas'),
            ),
          ],
        ],
      ),
    ),
  );
}
