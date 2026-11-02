import '../inbox/models.dart';
import '../inbox/inbox_model.dart';
import '../reviews/models.dart';
import '../reviews/reviews_model.dart';
import '../community/models.dart';
import '../community/community_model.dart';
import '../service_areas/models.dart';
import '../service_areas/service_areas_model.dart';
import '../opportunities/models.dart';
import '../opportunities/opportunities_model.dart';

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
import '../provider/models.dart';
import '../provider/provider_model.dart';
import '../support/models.dart';
import '../support/support_model.dart';

enum HomeStatus { starting, signedOut, loading, ready, failed }

class HomeModel extends ChangeNotifier {
  HomeModel(
    this.config,
    this.auth,
    this.repository, {
    RequestsRepository? requestsRepository,
    InboxRepository? inboxRepository,
    ReviewsRepository? reviewsRepository,
    CommunityRepository? communityRepository,
    AccountRepository? accountRepository,
    ProviderRepository? providerRepository,
    SupportRepository? supportRepository,
    ServiceAreasRepository? serviceAreasRepository,
    OpportunitiesRepository? opportunitiesRepository,
  }) {
    opportunities = OpportunitiesModel(
      opportunitiesRepository ?? OpportunitiesRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    community = CommunityModel(
      communityRepository ?? CommunityRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    requests = RequestsModel(
      requestsRepository ?? RequestsRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    support = SupportModel(
      supportRepository ?? SupportRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    serviceAreas = ServiceAreasModel(
      serviceAreasRepository ?? ServiceAreasRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    reviews = ReviewsModel(
      reviewsRepository ?? ReviewsRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    inbox = InboxModel(
      inboxRepository ?? InboxRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
    account = AccountModel(
      accountRepository ?? AccountRepository(repository.api),
      onSessionExpired: _sessionExpired,
      support: support,
      serviceAreas: serviceAreas,
      reviews: reviews,
      inbox: inbox,
    );
    provider = ProviderModel(
      providerRepository ?? ProviderRepository(repository.api),
      onSessionExpired: _sessionExpired,
    );
  }
  late final CommunityModel community;
  bool showCommunity = false;
  bool get canViewCommunity => canViewRequests;
  Future<void> openCommunity() async {
    if (!canViewCommunity) return;
    _closeOpportunities();
    showAccount = false;
    account.closeNotifications();
    account.closeSupport();
    account.closeServiceAreas();
    account.closeReviews();
    account.closeInbox();
    showRequests = false;
    requests.closeDetail();
    showCommunity = true;
    _emit();
    if (community.status == CommunityStatus.idle) await community.load();
  }

  void _closeCommunity() {
    showCommunity = false;
    community.close();
  }

  late final OpportunitiesModel opportunities;
  bool showOpportunities = false;
  bool get canViewOpportunities => canViewProvider;
  Future<void> openOpportunities() async {
    if (!canViewOpportunities) return;
    _closeCommunity();
    showAccount = false;
    account.closeNotifications();
    account.closeSupport();
    account.closeServiceAreas();
    account.closeReviews();
    account.closeInbox();
    showRequests = false;
    requests.closeDetail();
    showOpportunities = true;
    _emit();
    if (opportunities.status == OpportunitiesStatus.idle) {
      await opportunities.load();
    }
  }

  void _closeOpportunities() {
    showOpportunities = false;
    opportunities.close();
  }

  late final InboxModel inbox;
  bool get canViewInbox => canViewAccount;
  late final ReviewsModel reviews;
  bool get canViewReviews => canViewProvider;
  late final ServiceAreasModel serviceAreas;
  bool get canViewServiceAreas => canViewProvider;
  late final SupportModel support;
  bool get canViewSupport => canViewAccount;
  late final ProviderModel provider;
  bool get canViewProvider =>
      signedIn &&
      data?.context.role == 'provider' &&
      data?.profile.id == data?.context.userId;
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
    _closeCommunity();
    _closeOpportunities();
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
    _closeCommunity();
    _closeOpportunities();
    showAccount = false;
    account.closeNotifications();
    account.closeSupport();
    account.closeServiceAreas();
    account.closeReviews();
    account.closeInbox();
    showRequests = true;
    _emit();
    if (requests.listStatus == RequestStatus.idle) await requests.loadList();
  }

  void showHome() {
    _closeCommunity();
    _closeOpportunities();
    showAccount = false;
    account.closeNotifications();
    account.closeSupport();
    account.closeServiceAreas();
    account.closeReviews();
    account.closeInbox();
    showRequests = false;
    requests.closeDetail();
    _emit();
  }

  void _clearPrivateState() {
    showCommunity = false;
    community.clear();
    showOpportunities = false;
    opportunities.clear();
    provider.clear();
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
      community.setOwner(
        loaded.context.role == 'homeowner' ? loaded.profile.id : null,
      );
      account.setOwner(loaded.profile.id, loaded.context.role);
      opportunities.setOwner(
        loaded.context.role == 'provider' ? loaded.profile.id : null,
      );
      provider.setOwner(
        loaded.context.role == 'provider' ? loaded.profile.id : null,
      );
      status = HomeStatus.ready;
      _emit();
      // Local provider failures preserve matched identity and Account access.
      if (loaded.context.role == 'provider') await provider.load();
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
    community.dispose();
    account.dispose();
    provider.dispose();
    support.dispose();
    serviceAreas.dispose();
    reviews.dispose();
    inbox.dispose();
    opportunities.dispose();
    super.dispose();
  }
}
