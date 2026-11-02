import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

/// Deliberately excludes money/trend and inbox aggregates with separate semantics.
class ProviderOverview {
  ProviderOverview.fromJson(Map<String, dynamic> json)
    : companyName = nullableWireText(json, 'companyName'),
      accountStatus = field<String>(json, 'accountStatus'),
      activeBids = _count(json, 'activeBids'),
      jobsCompleted = _count(json, 'jobsCompleted'),
      activeJobs = _count(json, 'activeJobs'),
      reviewsCount = _count(json, 'reviewsCount'),
      winRatePct = _winRate(json),
      averageRating = _rating(json) {
    if (!{'pending', 'active', 'suspended'}.contains(accountStatus)) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String? companyName;
  final String accountStatus;
  final int activeBids, jobsCompleted, activeJobs, reviewsCount;
  final int? winRatePct;
  final double? averageRating;
  static int _count(Map<String, dynamic> json, String key) {
    final value = field<int>(json, key);
    if (value < 0 || value > 9007199254740991) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value;
  }

  static int? _winRate(Map<String, dynamic> json) {
    if (!json.containsKey('winRatePct')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    if (json['winRatePct'] == null) return null;
    final value = field<int>(json, 'winRatePct');
    if (value < 0 || value > 100) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value;
  }

  static double? _rating(Map<String, dynamic> json) {
    if (!json.containsKey('averageRating')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    if (json['averageRating'] == null) return null;
    final value = field<num>(json, 'averageRating');
    if (!value.isFinite || value < 1 || value > 5) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value.toDouble();
  }
}

class ProviderRepository {
  ProviderRepository(this.api);
  final ApiClient api;
  Future<ProviderOverview> loadOverview() async {
    final envelope = await api.get('/api/provider/overview');
    return ProviderOverview.fromJson(
      field<Map<String, dynamic>>(envelope, 'overview'),
    );
  }
}
