import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

String _text(Map<String, dynamic> json, String key) {
  final value = field<String>(json, key);
  if (value.trim().isEmpty) throw const ApiFailure(FailureKind.invalidResponse);
  return value;
}

class CommunityRequest {
  CommunityRequest.fromJson(Map<String, dynamic> json)
    : id = _text(json, 'id'),
      communityId = _text(json, 'communityId'),
      title = _text(json, 'title'),
      categoryLabel = _text(json, 'categoryLabel'),
      status = _text(json, 'status'),
      description = field<String>(json, 'description'),
      createdAt = wireDate(json, 'createdAt', nullable: false)!;
  final String id, communityId, title, categoryLabel, status, description;
  final DateTime createdAt;
}

class CommunityHub {
  CommunityHub.fromJson(Map<String, dynamic> json)
    : communityId = _text(json, 'communityId'),
      communityName = _text(json, 'communityName'),
      activeNeighbourCount = field<int>(json, 'activeNeighbourCount'),
      managerName = nullableWireText(json, 'managerName') {
    if (activeNeighbourCount < 0 || activeNeighbourCount > 9007199254740991) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final rows = field<List<dynamic>>(json, 'requests');
    if (rows.length > 50) throw const ApiFailure(FailureKind.invalidResponse);
    requests = List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        final item = CommunityRequest.fromJson(row);
        if (item.communityId != communityId) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return item;
      }),
    );
    if (requests.map((item) => item.id).toSet().length != requests.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String communityId, communityName;
  final int activeNeighbourCount;
  final String? managerName;
  late final List<CommunityRequest> requests;
}

class CommunityRepository {
  CommunityRepository(this.api);
  final ApiClient api;
  Future<CommunityHub?> load() async {
    final envelope = await api.get('/api/homeowner/neighbourhood');
    if (!envelope.containsKey('hub')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    if (envelope['hub'] == null) return null;
    return CommunityHub.fromJson(field<Map<String, dynamic>>(envelope, 'hub'));
  }
}
