import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

class PublishedReview {
  PublishedReview.fromJson(Map<String, dynamic> json)
    : id = field<String>(json, 'id'),
      reviewerName = field<String>(json, 'reviewerName'),
      rating = field<int>(json, 'rating'),
      comment = field<String>(json, 'comment'),
      subjectLabel = nullableWireText(json, 'subjectLabel'),
      createdAt = wireDate(json, 'createdAt', nullable: false)! {
    if (id.trim().isEmpty || rating < 1 || rating > 5) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String id, reviewerName, comment;
  final int rating;
  final String? subjectLabel;
  final DateTime createdAt;
}

class ReviewsPage {
  ReviewsPage.fromJson(Map<String, dynamic> json) {
    final paging = field<Map<String, dynamic>>(json, 'page');
    limit = field<int>(paging, 'limit');
    offset = field<int>(paging, 'offset');
    hasMore = field<bool>(paging, 'hasMore');
    final summary = field<Map<String, dynamic>>(json, 'summary');
    totalCount = field<int>(summary, 'totalCount');
    if (limit != 20 ||
        offset != 0 ||
        totalCount < 0 ||
        totalCount > 9007199254740991 ||
        !summary.containsKey('averageRating')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final average = summary['averageRating'];
    if (average != null &&
        (average is! num || !average.isFinite || average < 1 || average > 5)) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    averageRating = (average as num?)?.toDouble();
    final rows = field<List<dynamic>>(json, 'reviews');
    if (rows.length > 20) throw const ApiFailure(FailureKind.invalidResponse);
    reviews = List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return PublishedReview.fromJson(row);
      }),
    );
    if (reviews.map((item) => item.id).toSet().length != reviews.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  late final List<PublishedReview> reviews;
  late final bool hasMore;
  late final int limit, offset, totalCount;
  late final double? averageRating;
}

class ReviewsRepository {
  ReviewsRepository(this.api);
  final ApiClient api;
  Future<ReviewsPage> load() async => ReviewsPage.fromJson(
    await api.get('/api/provider/ratings?limit=20&offset=0'),
  );
}
