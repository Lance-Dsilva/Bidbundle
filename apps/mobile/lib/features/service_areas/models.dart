import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

class ServiceArea {
  ServiceArea.fromJson(Map<String, dynamic> json)
    : id = field<String>(json, 'id'),
      label = field<String>(json, 'label'),
      isPrimary = field<bool>(json, 'isPrimary'),
      locality = nullableWireText(json, 'locality'),
      region = nullableWireText(json, 'region'),
      radiusMiles = _radius(json),
      status = field<String>(json, 'status'),
      updatedAt = wireDate(json, 'updatedAt', nullable: false)! {
    if (id.trim().isEmpty || label.trim().isEmpty || status != 'active') {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    postalCodes = List.unmodifiable(
      field<List<dynamic>>(json, 'postalCodes').map((value) {
        if (value is! String) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return value;
      }),
    );
  }
  final String id, label, status;
  final bool isPrimary;
  final String? locality, region;
  final double? radiusMiles;
  final DateTime updatedAt;
  late final List<String> postalCodes;
  static double? _radius(Map<String, dynamic> json) {
    if (!json.containsKey('radiusMiles')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    if (json['radiusMiles'] == null) return null;
    final value = field<num>(json, 'radiusMiles');
    if (!value.isFinite || value < 1 || value > 100) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return value.toDouble();
  }
}

class ServiceAreasRepository {
  ServiceAreasRepository(this.api);
  final ApiClient api;
  Future<List<ServiceArea>> load() async {
    final envelope = await api.get('/api/provider/service-areas');
    final items = List<ServiceArea>.unmodifiable(
      field<List<dynamic>>(envelope, 'areas').map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return ServiceArea.fromJson(row);
      }),
    );
    if (items.map((item) => item.id).toSet().length != items.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return items;
  }
}
