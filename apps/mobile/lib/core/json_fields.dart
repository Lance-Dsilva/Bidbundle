import 'api.dart';

DateTime? wireDate(
  Map<String, dynamic> json,
  String key, {
  bool nullable = true,
}) {
  if (!json.containsKey(key)) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  final value = json[key];
  if (nullable && value == null) return null;
  if (value is! String) throw const ApiFailure(FailureKind.invalidResponse);
  final parsed = DateTime.tryParse(value);
  if (parsed == null || !parsed.isUtc || parsed.toIso8601String() != value) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return parsed;
}

String? nullableWireText(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key) || (json[key] != null && json[key] is! String)) {
    throw const ApiFailure(FailureKind.invalidResponse);
  }
  return json[key] as String?;
}
