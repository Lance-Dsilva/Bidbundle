import '../../core/api.dart';
import '../home/models.dart';

String requestText(Map<String, dynamic> json, String key) {
  final value = field<String>(json, key);
  if (value.trim().isEmpty) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return value;
}

int requestCount(Map<String, dynamic> json, String key) {
  final value = field<int>(json, key);
  if (value < 0 || value > 9007199254740991) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return value;
}

int? requestMoney(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key)) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return json[key] == null ? null : requestCount(json, key);
}

DateTime? requestDate(
  Map<String, dynamic> json,
  String key, {
  bool nullable = true,
}) {
  if (!json.containsKey(key)) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  if (nullable && json[key] == null) return null;
  final value = field<String>(json, key);
  final parsed = DateTime.tryParse(value);
  // Server toISOString emits canonical UTC instants. Reject normalized invalid dates.
  if (parsed == null || !parsed.isUtc || parsed.toIso8601String() != value) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return parsed;
}

/// Only the list fields rendered by this read-only slice are retained.
class RequestSummary {
  RequestSummary.fromJson(Map<String, dynamic> json)
    : id = requestText(json, 'id'),
      title = requestText(json, 'title'),
      categoryLabel = requestText(json, 'categoryLabel'),
      status = requestText(json, 'status'),
      context = requestText(json, 'context'),
      communityName = requestText(json, 'communityName'),
      budgetMinCents = requestMoney(json, 'budgetMinCents'),
      budgetMaxCents = requestMoney(json, 'budgetMaxCents'),
      bestBidCents = requestMoney(json, 'bestBidCents'),
      bidCount = requestCount(json, 'bidCount'),
      createdAt = requestDate(json, 'createdAt', nullable: false)!,
      enrollmentClosesAt = requestDate(json, 'enrollmentClosesAt') {
    if (context != 'hoa' && context != 'neighborhood') {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String id, title, categoryLabel, status, context, communityName;
  final int? budgetMinCents, budgetMaxCents, bestBidCents;
  final int bidCount;
  final DateTime createdAt;
  final DateTime? enrollmentClosesAt;
}

class RequestList {
  RequestList.fromJson(Map<String, dynamic> json) {
    final rows = field<List<dynamic>>(json, 'requests');
    items = List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return RequestSummary.fromJson(row);
      }),
    );
    final eligibility = field<Map<String, dynamic>>(json, 'eligibility');
    final canCreate = field<bool>(eligibility, 'canCreate');
    if (canCreate) {
      requestText(eligibility, 'communityId');
      requestText(eligibility, 'communityName');
      eligibilityMessage = null;
    } else {
      requestText(eligibility, 'reason');
      eligibilityMessage = requestText(eligibility, 'message');
      // Do not navigate to actionPath: this slice has no creation/HOA/profile flow.
      requestText(eligibility, 'actionLabel');
      requestText(eligibility, 'actionPath');
    }
  }
  late final List<RequestSummary> items;
  late final String? eligibilityMessage;
}

/// A separate server-authorized detail DTO; never synthesized from list data.
class RequestDetail {
  RequestDetail.fromJson(Map<String, dynamic> json)
    : id = requestText(json, 'id'),
      title = requestText(json, 'title'),
      categoryLabel = requestText(json, 'categoryLabel'),
      description = field<String>(json, 'description'),
      status = requestText(json, 'status'),
      communityName = requestText(json, 'communityName'),
      budgetMinCents = requestMoney(json, 'budgetMinCents'),
      budgetMaxCents = requestMoney(json, 'budgetMaxCents'),
      bidCount = requestCount(json, 'bidCount'),
      joinedCount = requestCount(json, 'joinedCount'),
      totalOccurrences = requestCount(json, 'totalOccurrences'),
      createdAt = requestDate(json, 'createdAt', nullable: false)!,
      enrollmentClosesAt = requestDate(json, 'enrollmentClosesAt'),
      biddingClosesAt = requestDate(json, 'biddingClosesAt'),
      startDate = requestDate(json, 'startDate');
  final String id, title, categoryLabel, description, status, communityName;
  final int? budgetMinCents, budgetMaxCents;
  final int bidCount, joinedCount, totalOccurrences;
  final DateTime createdAt;
  final DateTime? enrollmentClosesAt, biddingClosesAt, startDate;
}

class RequestsRepository {
  RequestsRepository(this.api);
  final ApiClient api;
  Future<RequestList> loadList() async =>
      RequestList.fromJson(await api.get('/api/homeowner/requests'));
  Future<RequestDetail> loadDetail(String id) async {
    if (id.trim().isEmpty || id == '.' || id == '..') {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final envelope = await api.get(
      '/api/homeowner/requests/${Uri.encodeComponent(id)}',
    );
    final detail = RequestDetail.fromJson(
      field<Map<String, dynamic>>(envelope, 'request'),
    );
    if (detail.id != id) throw const ApiFailure(FailureKind.invalidResponse);
    return detail;
  }
}
