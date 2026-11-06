import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'reviews_model.dart';

class ReviewsScreen extends StatelessWidget {
  const ReviewsScreen({super.key, required this.model});
  final ReviewsModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final page = model.page;
      return RefreshIndicator(
        onRefresh: model.load,
        child: ListView(
          key: const PageStorageKey('published-reviews'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'Published reviews',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            const Text(
              'Up to 20 recent published reviews. Read-only preview; responses and review changes are not available here.',
            ),
            if (model.status == ReviewsStatus.loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(
                  child: CircularProgressIndicator(
                    semanticsLabel: 'Loading published reviews',
                  ),
                ),
              ),
            if (model.status == ReviewsStatus.failed) ...[
              const SizedBox(height: 20),
              Semantics(liveRegion: true, child: Text(model.message!)),
              OutlinedButton(onPressed: model.load, child: const Text('Retry')),
            ],
            if (model.status == ReviewsStatus.ready && page != null) ...[
              const SizedBox(height: 20),
              Text('All published reviews: ${page.totalCount}'),
              Text(
                page.averageRating == null
                    ? 'Average rating: Not available'
                    : 'Average across published reviews: ${page.averageRating!.toStringAsFixed(1)} out of 5',
              ),
              if (page.hasMore)
                const Text(
                  'More published reviews are available beyond this first page. Further pages are not available in this preview.',
                ),
              if (page.reviews.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Text('No published reviews on this page.'),
                ),
              ...page.reviews.map(
                (review) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          review.reviewerName,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text('${review.rating} out of 5'),
                        if (review.subjectLabel != null)
                          Text(review.subjectLabel!),
                        const SizedBox(height: 12),
                        Text(review.comment),
                        const SizedBox(height: 12),
                        Text(localInstantLabel(context, review.createdAt)),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: model.load,
                child: const Text('Refresh reviews'),
              ),
            ],
          ],
        ),
      );
    },
  );
}
