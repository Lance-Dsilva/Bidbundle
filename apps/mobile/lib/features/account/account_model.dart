import '../reviews/reviews_model.dart';
import '../service_areas/service_areas_model.dart';

import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';
import '../support/support_model.dart';

enum AccountStatus { idle, loading, ready, failed }

class AccountModel extends ChangeNotifier {
  AccountModel(
    this.repository, {
    required this.onSessionExpired,
    this.support,
    this.serviceAreas,
    this.reviews,
  });
  final ReviewsModel? reviews;
  bool showingReviews = false;
  bool get reviewsAvailable => reviews != null && _role == 'provider';
  Future<void> openReviews() async {
    if (!reviewsAvailable ||
        _owner == null ||
        profile == null ||
        profileStatus != AccountStatus.ready ||
        _disposed) {
      return;
    }
    closeNotifications();
    closeSupport();
    closeServiceAreas();
    showingReviews = true;
    _emit();
    if (reviews!.status == ReviewsStatus.idle) await reviews!.load();
  }

  void closeReviews() {
    showingReviews = false;
    reviews?.close();
    _emit();
  }

  final ServiceAreasModel? serviceAreas;
  bool showingServiceAreas = false;
  bool get serviceAreasAvailable => serviceAreas != null && _role == 'provider';
  Future<void> openServiceAreas() async {
    if (!serviceAreasAvailable ||
        _owner == null ||
        profile == null ||
        profileStatus != AccountStatus.ready ||
        _disposed) {
      return;
    }
    closeNotifications();
    closeSupport();
    closeReviews();
    showingServiceAreas = true;
    _emit();
    if (serviceAreas!.status == ServiceAreasStatus.idle) {
      await serviceAreas!.load();
    }
  }

  void closeServiceAreas() {
    showingServiceAreas = false;
    serviceAreas?.close();
    _emit();
  }

  final SupportModel? support;
  bool showingSupport = false;
  bool get supportAvailable => support != null;
  Future<void> openSupport() async {
    if (_owner == null ||
        profile == null ||
        profileStatus != AccountStatus.ready ||
        _disposed ||
        support == null) {
      return;
    }
    closeNotifications();
    closeServiceAreas();
    closeReviews();
    showingSupport = true;
    _emit();
    if (support!.listStatus == SupportStatus.idle) await support!.loadList();
  }

  void closeSupport() {
    showingSupport = false;
    support?.close();
    _emit();
  }

  final AccountRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner, _role;
  int _profileGeneration = 0, _notificationsGeneration = 0;
  bool _disposed = false;
  AccountStatus profileStatus = AccountStatus.idle,
      notificationsStatus = AccountStatus.idle;
  AccountProfile? profile;
  List<NotificationItem> notifications = const [];
  String? profileMessage, notificationsMessage;
  bool showingNotifications = false;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id, String? role) {
    if (_owner == id && _role == role) return;
    clear();
    if (id != null && id.isNotEmpty && personalAccountRoles.contains(role)) {
      _owner = id;
      _role = role;
      support?.setOwner(id);
      serviceAreas?.setOwner(role == 'provider' ? id : null);
      reviews?.setOwner(role == 'provider' ? id : null);
    }
  }

  void clear() {
    showingReviews = false;
    reviews?.clear();
    showingServiceAreas = false;
    serviceAreas?.clear();
    showingSupport = false;
    support?.clear();
    _owner = null;
    _role = null;
    _profileGeneration++;
    _notificationsGeneration++;
    profile = null;
    notifications = const [];
    showingNotifications = false;
    profileMessage = null;
    notificationsMessage = null;
    profileStatus = AccountStatus.idle;
    notificationsStatus = AccountStatus.idle;
    _emit();
  }

  bool _current(
    String owner,
    String role,
    int generation, {
    bool isNotifications = false,
  }) =>
      !_disposed &&
      _owner == owner &&
      _role == role &&
      generation ==
          (isNotifications ? _notificationsGeneration : _profileGeneration);
  Future<void> loadProfile() async {
    final owner = _owner, role = _role;
    if (owner == null ||
        role == null ||
        _disposed ||
        profileStatus == AccountStatus.loading) {
      return;
    }
    final generation = ++_profileGeneration;
    closeReviews();
    closeServiceAreas();
    closeNotifications();
    closeSupport();
    _notificationsGeneration++;
    notifications = const [];
    notificationsStatus = AccountStatus.idle;
    notificationsMessage = null;
    profile = null;
    profileMessage = null;
    profileStatus = AccountStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadProfile(owner, role);
      if (!_current(owner, role, generation)) return;
      profile = loaded;
      profileStatus = AccountStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, role, generation)) return;
      if (_expire(error)) return;
      profileStatus = AccountStatus.failed;
      profileMessage = error is ApiFailure
          ? error.message
          : 'We could not load your account details. Please try again.';
      _emit();
    }
  }

  Future<void> openNotifications() async {
    if (_owner == null ||
        profile == null ||
        profileStatus != AccountStatus.ready ||
        _disposed) {
      return;
    }
    closeSupport();
    closeServiceAreas();
    closeReviews();
    showingNotifications = true;
    _emit();
    if (notificationsStatus == AccountStatus.idle) await loadNotifications();
  }

  Future<void> loadNotifications() async {
    final owner = _owner, role = _role;
    if (owner == null ||
        role == null ||
        profile == null ||
        _disposed ||
        notificationsStatus == AccountStatus.loading) {
      return;
    }
    final generation = ++_notificationsGeneration;
    notifications = const [];
    notificationsMessage = null;
    notificationsStatus = AccountStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadNotifications();
      if (!_current(owner, role, generation, isNotifications: true)) return;
      notifications = loaded;
      notificationsStatus = AccountStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, role, generation, isNotifications: true)) return;
      if (_expire(error)) return;
      notificationsStatus = AccountStatus.failed;
      notificationsMessage = error is ApiFailure
          ? error.message
          : 'We could not load recent notifications. Please try again.';
      _emit();
    }
  }

  bool _expire(Object error) {
    if (error is! ApiFailure || error.kind != FailureKind.unauthenticated) {
      return false;
    }
    clear();
    onSessionExpired();
    return true;
  }

  void closeNotifications() {
    showingNotifications = false;
    _notificationsGeneration++;
    // A closed route never retains notifications that may finish loading later.
    notifications = const [];
    notificationsMessage = null;
    notificationsStatus = AccountStatus.idle;
    _emit();
  }

  @override
  void dispose() {
    _disposed = true;
    _profileGeneration++;
    _notificationsGeneration++;
    super.dispose();
  }
}
