import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

const personalAccountRoles = {'homeowner', 'provider', 'hoa_staff'};

/// Account presentation only: email verification grants no provider/HOA role.
/// Unused coordinates and avatar URLs are deliberately not retained or fetched.
class AccountProfile {
  AccountProfile.fromJson(Map<String, dynamic> json)
    : id = field<String>(json, 'id'),
      name = field<String>(json, 'fullName'),
      email = field<String>(json, 'email'),
      role = field<String>(json, 'role'),
      isVerified = field<bool>(json, 'isVerified'),
      phone = nullableWireText(json, 'phone'),
      address = nullableWireText(json, 'address'),
      neighborhood = nullableWireText(json, 'neighborhood'),
      createdAt = wireDate(json, 'createdAt', nullable: false)! {
    if (id.trim().isEmpty) throw const ApiFailure(FailureKind.invalidResponse);
  }
  final String id, name, email, role;
  final bool isVerified;
  final String? phone, address, neighborhood;
  final DateTime createdAt;
}

class NotificationItem {
  NotificationItem.fromJson(Map<String, dynamic> json)
    : id = field<String>(json, 'id'),
      kind = field<String>(json, 'kind'),
      title = field<String>(json, 'title'),
      body = field<String>(json, 'body'),
      linkPath = nullableWireText(json, 'linkPath'),
      readAt = wireDate(json, 'readAt'),
      createdAt = wireDate(json, 'createdAt', nullable: false)! {
    if (id.trim().isEmpty) throw const ApiFailure(FailureKind.invalidResponse);
  }
  final String id, kind, title, body;
  // Stored as data only. No navigation or URL launching in this slice.
  final String? linkPath;
  final DateTime? readAt;
  final DateTime createdAt;
}

class AccountRepository {
  AccountRepository(this.api);
  final ApiClient api;
  Future<AccountProfile> loadProfile(
    String expectedId,
    String expectedRole,
  ) async {
    if (!personalAccountRoles.contains(expectedRole) || expectedId.isEmpty) {
      throw const ApiFailure(FailureKind.forbidden);
    }
    final profile = AccountProfile.fromJson(await api.get('/api/profile'));
    if (profile.id != expectedId || profile.role != expectedRole) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return profile;
  }

  Future<List<NotificationItem>> loadNotifications() async {
    final envelope = await api.get('/api/me/notifications');
    final rows = field<List<dynamic>>(envelope, 'notifications');
    return List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return NotificationItem.fromJson(row);
      }),
    );
  }
}
