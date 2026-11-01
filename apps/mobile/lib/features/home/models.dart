import '../../core/api.dart';

T field<T>(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! T) throw const ApiFailure(FailureKind.invalidResponse);
  return value;
}

class Profile {
  Profile.fromJson(Map<String, dynamic> json)
    : id = field<String>(json, 'id'),
      name = field<String>(json, 'fullName'),
      role = field<String>(json, 'role');
  final String id, name, role;
}

class ViewerContext {
  ViewerContext.fromJson(Map<String, dynamic> json)
    : userId = field<String>(json, 'userId'),
      role = field<String>(json, 'role'),
      roleLabel = field<String>(json, 'roleLabel'),
      canManageCommunity = field<bool>(json, 'canManageCommunity');
  final String userId, role, roleLabel;
  // Display only; never used to authorize a request.
  final bool canManageCommunity;
}

class Dashboard {
  Dashboard.fromJson(Map<String, dynamic> json)
    : coldStart = field<bool>(json, 'cold_start'),
      activeRequests = _count(json, 'active_requests'),
      activeBids = _count(json, 'active_bids'),
      savedCents = _count(json, 'total_saved_cents');
  final bool coldStart;
  final int activeRequests, activeBids, savedCents;
  static int _count(Map<String, dynamic> json, String key) {
    final value = field<int>(json, key);
    if (value < 0) throw const ApiFailure(FailureKind.invalidResponse);
    return value;
  }
}

class HomeData {
  const HomeData(this.profile, this.context, this.dashboard);
  final Profile profile;
  final ViewerContext context;
  final Dashboard? dashboard;
}

class HomeRepository {
  HomeRepository(this.api);
  final ApiClient api;
  Future<HomeData> load() async {
    final profile = Profile.fromJson(await api.get('/api/profile'));
    final context = ViewerContext.fromJson(await api.get('/api/me/context'));
    if (context.userId != profile.id || context.role != profile.role) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final dashboard = context.role == 'homeowner'
        ? Dashboard.fromJson(await api.get('/api/homeowner/dashboard'))
        : null;
    return HomeData(profile, context, dashboard);
  }
}
