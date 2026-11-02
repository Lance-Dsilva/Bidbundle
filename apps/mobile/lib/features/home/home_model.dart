import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/auth.dart';
import '../../core/config.dart';
import 'models.dart';
import '../requests/models.dart';
import '../requests/requests_model.dart';
import '../account/models.dart';
import '../account/account_model.dart';

enum HomeStatus { starting, signedOut, loading, ready, failed }

class HomeModel extends ChangeNotifier {
  HomeModel(
    this.config,
    this.auth,
    this.repository, {
    RequestsRepository? requestsRepository,
    AccountRepository? accountRepository,
  }) {
    requests = RequestsModel(
      requestsRepository ?? RequestsRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    account = AccountModel(
      accountRepository ?? AccountRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
  }
  late final RequestsModel requests;
  late final AccountModel account;
  bool showAccount = false;
  bool get canViewAccount =>
      signedIn &&
      data != null &&
      personalAccountRoles.contains(data!.context.role) &&
      data!.profile.id == data!.context.userId;
  Future<void> openAccount() async {
    if (!canViewAccount) return;
    showRequests = false;
    requests.closeDetail();
    showAccount = true;
    _emit();
    if (account.profileStatus == AccountStatus.idle) {
      await account.loadProfile();
    }
  }

  bool showRequests = false;
  bool get canViewRequests =>
      signedIn &&
      data?.context.role == 'homeowner' &&
      data?.profile.id == data?.context.userId;
  Future<void> openRequests() async {
    if (!canViewRequests) return;
    showAccount = false;
    account.closeNotifications();
    showRequests = true;
    _emit();
    if (requests.listStatus == RequestStatus.idle) await requests.loadList();
  }

  void showHome() {
    showAccount = false;
    account.closeNotifications();
    showRequests = false;
    requests.closeDetail();
    _emit();
  }

  void _clearPrivateState() {
    showAccount = false;
    account.clear();
    showRequests = false;
    requests.clear();
  }

  void _sessionExpired() {
    if (_disposed) return;
    _generation++;
    signedIn = false;
    data = null;
    status = HomeStatus.signedOut;
    message = const ApiFailure(FailureKind.unauthenticated).message;
    _clearPrivateState();
    _emit();
  }

  final AppConfig config;
  final AuthSession auth;
  final HomeRepository repository;
  HomeStatus status = HomeStatus.starting;
  HomeData? data;
  String? message;
  bool signedIn = false;
  bool initialized = false;
  bool logoutPending = false;
  int _generation = 0;
  bool _disposed = false;
  bool get busy =>
      status == HomeStatus.starting || status == HomeStatus.loading;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int generation) => !_disposed && generation == _generation;
  Future<void> initialize() async {
    if (logoutPending) return;
    status = HomeStatus.starting;
    initialized = false;
    signedIn = false;
    data = null;
    _clearPrivateState();
    message = null;
    _emit();
    final generation = ++_generation;
    try {
      final active = await auth.initialize(config.publishableKey);
      if (!_current(generation)) return;
      initialized = true;
      signedIn = active;
      if (active) {
        await refresh();
      } else {
        status = HomeStatus.signedOut;
        _emit();
      }
    } catch (_) {
      if (!_current(generation)) return;
      status = HomeStatus.signedOut;
      message = 'Secure sign-in is unavailable. Please try again later.';
      _emit();
    }
  }

  Future<void> authenticate({bool createAccount = false}) async {
    if (busy || logoutPending || !initialized) return;
    final generation = ++_generation;
    status = HomeStatus.loading;
    message = null;
    data = null;
    _clearPrivateState();
    _emit();
    try {
      if (createAccount) {
        await auth.signUp();
      } else {
        await auth.signIn();
      }
      if (!_current(generation)) return;
      signedIn = true;
      await refresh();
    } on PlatformException catch (error) {
      if (!_current(generation)) return;
      status = HomeStatus.signedOut;
      signedIn = false;
      message = error.code == 'cancelled'
          ? 'Sign-in cancelled.'
          : 'Sign-in could not be completed. Please try again.';
      _emit();
    } catch (_) {
      if (!_current(generation)) return;
      status = HomeStatus.signedOut;
      signedIn = false;
      message = 'Sign-in could not be completed. Please try again.';
      _emit();
    }
  }

  Future<void> refresh() async {
    if (!signedIn) return;
    final generation = ++_generation;
    status = HomeStatus.loading;
    data = null;
    _clearPrivateState();
    message = null;
    _emit();
    try {
      final loaded = await repository.load();
      if (!_current(generation)) return;
      data = loaded;
      requests.setOwner(
        loaded.context.role == 'homeowner' ? loaded.profile.id : null,
      );
      account.setOwner(loaded.profile.id, loaded.context.role);
      status = HomeStatus.ready;
      _emit();
    } on ApiFailure catch (error) {
      if (!_current(generation)) return;
      if (error.kind == FailureKind.unauthenticated) signedIn = false;
      status = signedIn ? HomeStatus.failed : HomeStatus.signedOut;
      message = error.message;
      _emit();
    } catch (_) {
      if (!_current(generation)) return;
      status = HomeStatus.failed;
      message = 'We could not load your account. Please try again.';
      _emit();
    }
  }

  Future<void> signOut() async {
    final generation = ++_generation;
    signedIn = false;
    logoutPending = true;
    data = null;
    _clearPrivateState();
    message = null;
    status = HomeStatus.loading;
    _emit();
    try {
      await auth.signOut();
      if (_current(generation)) logoutPending = false;
    } catch (_) {
      if (!_current(generation)) return;
      message = 'Local view cleared. Session sign-out could not be confirmed; try again when connected.';
    }
    if (!_current(generation)) return;
    status = HomeStatus.signedOut;
    _emit();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    requests.dispose();
    account.dispose();
    super.dispose();
  }
}
