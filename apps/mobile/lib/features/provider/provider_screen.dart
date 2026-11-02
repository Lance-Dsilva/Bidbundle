import 'package:flutter/material.dart';

import 'provider_model.dart';

/// A child overview; a console failure never removes personal Account access.
class ProviderScreen extends StatelessWidget {
  const ProviderScreen({
    super.key,
    required this.model,
    required this.fallbackName,
  });
  final ProviderModel model;
  final String fallbackName;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final overview = model.overview;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Provider overview',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 16),
          if (model.status == ProviderStatus.loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Loading provider overview',
                ),
              ),
            ),
          if (model.status == ProviderStatus.failed) ...[
            Semantics(liveRegion: true, child: Text(model.message!)),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: model.load,
              child: const Text('Retry provider overview'),
            ),
          ],
          if (model.status == ProviderStatus.ready && overview != null) ...[
            Text(
              overview.companyName ?? fallbackName,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(switch (overview.accountStatus) {
              'pending' => 'Provider account: Pending review',
              'active' => 'Provider account: Active',
              'suspended' => 'Provider account: Suspended',
              _ => 'Provider account status unavailable',
            }, style: Theme.of(context).textTheme.titleMedium),
            if (overview.accountStatus == 'pending')
              const Text(
                'Your provider account is pending review. Your recorded activity is shown below.',
              ),
            if (overview.accountStatus == 'suspended')
              const Text(
                'Your provider account is suspended. Your recorded activity remains available.',
              ),
            const SizedBox(height: 12),
            if (overview.activeBids == 0 &&
                overview.activeJobs == 0 &&
                overview.jobsCompleted == 0)
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text(
                  'No active bids, active agreements or completed agreements to show.',
                ),
              ),
            _Metric(
              'Active bids',
              '${overview.activeBids}',
              'Submitted bids awaiting a decision',
            ),
            _Metric(
              'Active agreements',
              '${overview.activeJobs}',
              'Agreements currently active',
            ),
            _Metric(
              'Completed agreements',
              '${overview.jobsCompleted}',
              'All time',
            ),
            _Metric(
              'Bid win rate',
              overview.winRatePct == null
                  ? 'Not available yet'
                  : '${overview.winRatePct}%',
              'Accepted bids among accepted and rejected bids',
            ),
            _Metric(
              'Published review rating',
              overview.averageRating == null
                  ? 'Not rated yet'
                  : '${overview.averageRating!.toStringAsFixed(1)} / 5',
              '${overview.reviewsCount} published reviews',
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: model.load,
              child: const Text('Refresh provider overview'),
            ),
          ],
          const SizedBox(height: 16),
          const Text(
            'Browsing only. Marketplace, bidding, scheduling, messaging and financial summaries are not available in this preview.',
          ),
        ],
      );
    },
  );
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value, this.description);
  final String label, value, description;
  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.symmetric(vertical: 6),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          Text(value, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(description),
        ],
      ),
    ),
  );
}
