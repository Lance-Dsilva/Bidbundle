import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

class Opportunity {
  Opportunity.fromJson(Map<String, dynamic> json)
    : requestId = _text(json, 'requestId'),
      title = _text(json, 'title'),
      communityName = _text(json, 'communityName'),
      context = _text(json, 'context'),
      category = _text(json, 'category'),
      kind = _text(json, 'kind'),
      description = field<String>(json, 'description'),
      locality = nullableWireText(json, 'locality'),
      region = nullableWireText(json, 'region'),
      recurrenceLabel = nullableWireText(json, 'recurrenceLabel'),
      totalOccurrences = _count(json, 'totalOccurrences'),
      homeCount = _count(json, 'homeCount'),
      approximateDistanceMi = _distance(json),
      startDate = wireDate(json, 'startDate'),
      biddingClosesAt = wireDate(json, 'biddingClosesAt') {
    if (!{'hoa', 'neighborhood'}.contains(context) ||
        !{'compulsory_recurring', 'optional_group'}.contains(kind)) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String requestId,
      title,
      communityName,
      context,
      category,
      kind,
      description;
  final String? locality, region, recurrenceLabel;
  final int totalOccurrences, homeCount;
  final double? approximateDistanceMi;
  final DateTime? startDate, biddingClosesAt;
  static String _text(Map<String, dynamic> json, String key) {
    final value = field<String>(json, key);
    if (value.trim().isEmpty) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value;
  }

  static int _count(Map<String, dynamic> json, String key) {
    final value = field<int>(json, key);
    if (value < 0 || value > 9007199254740991) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value;
  }

  static double? _distance(Map<String, dynamic> json) {
    if (!json.containsKey('approximateDistanceMi')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    if (json['approximateDistanceMi'] == null) return null;
    final value = field<num>(json, 'approximateDistanceMi');
    if (!value.isFinite || value < 0) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value.toDouble();
  }
}

/// Drops money, own bids, service areas and private awarded-work sections.
class OpportunitiesFeed {
  OpportunitiesFeed.fromJson(Map<String, dynamic> json)
    : eligible = field<bool>(json, 'eligible'),
      ineligibleReason = nullableWireText(json, 'ineligibleReason') {
    final rows = field<List<dynamic>>(json, 'feed');
    if (rows.length > 200 || (!eligible && rows.isNotEmpty)) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    items = List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return Opportunity.fromJson(row);
      }),
    );
    if (items.map((item) => item.requestId).toSet().length != items.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final bool eligible;
  final String? ineligibleReason;
  late final List<Opportunity> items;
}

class OpportunitiesRepository {
  OpportunitiesRepository(this.api);
  final ApiClient api;
  Future<OpportunitiesFeed> load() async => OpportunitiesFeed.fromJson(
    field<Map<String, dynamic>>(
      await api.get('/api/provider/marketplace'),
      'workspace',
    ),
  );
}
