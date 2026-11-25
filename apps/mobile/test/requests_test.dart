// Independent source-contract fixtures. No live backend/SDK/device is exercised.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/home/home_model.dart';
import 'package:bundleen/features/home/models.dart';
import 'package:bundleen/features/requests/models.dart';
import 'package:bundleen/features/requests/requests_model.dart';
import 'package:bundleen/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;

Map<String, Object?> summary({
  String id = 'r1',
  String context = 'neighborhood',
}) => {
  'id': id,
  'title': 'Garden care',
  'category': 'landscaping',
  'categoryLabel': 'Lawn & garden',
  'description': 'Trim the shared garden.',
  'status': 'collecting_interest',
  'context': context,
  'communityId': 'c1',
  'communityName': 'Test neighborhood',
  'budgetMinCents': null,
  'budgetMaxCents': 12345,
  'bestBidCents': null,
  'bidCount': 0,
  'enrollmentClosesAt': null,
  'createdAt': '2026-10-01T12:00:00.000Z',
  'updatedAt': '2026-10-02T12:00:00.000Z',
};
Map<String, Object?> detail({String id = 'r1'}) => {
  'id': id,
  'title': 'Server-authorized detail',
  'category': 'landscaping',
  'categoryLabel': 'Lawn & garden',
  'description': 'Only this returned detail is visible.',
  'status': 'collecting_interest',
  'communityId': 'c1',
  'communityName': 'Test neighborhood',
  'budgetMinCents': null,
  'budgetMaxCents': 12345,
  'minHomes': 1,
  'maxHomes': null,
  'totalOccurrences': 1,
  'joinedCount': 2,
  'declinedCount': 0,
  'bidCount': 1,
  'enrollmentClosesAt': null,
  'biddingClosesAt': null,
  'participantsLockedAt': null,
  'awardedAt': null,
  'startDate': null,
  'viewerResponse': null,
  'isOwner': true,
  'createdByName': 'Test Resident',
  'createdAt': '2026-10-01T12:00:00.000Z',
  'permissions': {
    'canRespond': false,
    'canManage': false,
    'canViewBids': true,
    'canEdit': true,
  },
  'bids': null,
  'participants': null,
  'agreement': null,
  'myVisits': <Object>[],
  'occurrences': null,
};
Map<String, Object?> listBody({
  List<Map<String, Object?>>? rows,
  String? reason,
}) => {
  'requests': rows ?? [summary()],
  'eligibility': reason == null
      ? {
          'canCreate': true,
          'communityId': 'c1',
          'communityName': 'Test neighborhood',
        }
      : {
          'canCreate': false,
          'reason': reason,
          'message': 'Coverage must be confirmed.',
          'actionLabel': 'Review profile',
          'actionPath': 'https://untrusted.example.invalid',
        },
};
RequestsRepository repository(base.FakeAuth auth, http.Client client) =>
    RequestsRepository(ApiClient(base.config(), auth, client));

http.Response requestsRoute(
  http.Request request, {
  String role = 'homeowner',
}) => switch (request.url.path) {
  '/api/profile' => base.jsonResponse(base.profile(role)),
  '/api/me/context' => base.jsonResponse(base.context(role)),
  '/api/homeowner/dashboard' => base.jsonResponse(base.dashboard()),
  '/api/homeowner/requests' => base.jsonResponse(listBody()),
  '/api/homeowner/requests/r1' => base.jsonResponse({'request': detail()}),
  _ => http.Response('', 404),
};
HomeModel home(base.FakeAuth auth, http.Client client) => HomeModel(
  base.config(),
  auth,
  HomeRepository(ApiClient(base.config(), auth, client)),
);

Future<void> render(WidgetTester tester, HomeModel vm) async {
  await tester.runAsync(() async {
    await tester.pumpWidget(BundleenApp(model: vm));
    await Future<void>.delayed(const Duration(milliseconds: 25));
  });
  await tester.pumpAndSettle();
}

Future<void> tapAndLoad(WidgetTester tester, Finder finder) async {
  await tester.runAsync(() async {
    await tester.tap(finder);
    await Future<void>.delayed(const Duration(milliseconds: 25));
  });
  await tester.pumpAndSettle();
}

class FailedRefreshAuth extends base.FakeAuth {
  @override
  Future<String?> token({bool forceRefresh = false}) async {
    if (forceRefresh) {
      throw PlatformException(
        code: 'token_failed',
        message: 'private SDK detail',
      );
    }
    return super.token(forceRefresh: forceRefresh);
  }
}

class InitialTokenErrorAuth extends base.FakeAuth {
  bool fail = false;
  @override
  Future<String?> token({bool forceRefresh = false}) async {
    if (fail) {
      throw PlatformException(code: 'offline', message: 'private SDK detail');
    }
    return super.token(forceRefresh: forceRefresh);
  }
}

void main() {
  test('detail parses without list-only fields; nullable budgets are not fabricated', () {
    final parsed = RequestDetail.fromJson(detail());
    expect(parsed.title, 'Server-authorized detail');
    final row = RequestSummary.fromJson(summary());
    expect(row.title, 'Garden care');
    expect(
      () => RequestSummary.fromJson(detail()),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });

  test('repository encodes opaque request IDs as one path segment', () async {
    final auth = base.FakeAuth()..active = true;
    const id = 'a/b?# space';
    final calls = <Uri>[];
    final repo = repository(
      auth,
      MockClient((request) async {
        calls.add(request.url);
        return base.jsonResponse({'request': detail(id: id)});
      }),
    );
    await repo.loadDetail(id);
    expect(calls.single.pathSegments.last, id);
    expect(calls.single.query, isEmpty);
    expect(calls.single.fragment, isEmpty);
    expect(calls.single.pathSegments.length, 4);
  });

  for (final code in [403, 404]) {
    test(
      'list visibility never substitutes for detail authorization $code',
      () async {
        final auth = base.FakeAuth()..active = true;
        final model = RequestsModel(
          repository(
            auth,
            MockClient(
              (request) async => request.url.path == '/api/homeowner/requests'
                  ? base.jsonResponse(listBody())
                  : http.Response('', code),
            ),
          ),
          onSessionExpired: () {},
        );
        addTearDown(model.dispose);
        model.setOwner('u1');
        await model.loadList();
        expect(model.items, hasLength(1));
        await model.openDetail('r1');
        expect(model.detailStatus, RequestStatus.failed);
        expect(model.detail, isNull);
        expect(model.detailMessage, isNotNull);
      },
    );
  }

  test(
    'owner change invalidates an in-flight detail and clears previous list',
    () async {
      final auth = base.FakeAuth()..active = true;
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final model = RequestsModel(
        repository(
          auth,
          MockClient((request) async {
            if (request.url.path == '/api/homeowner/requests') {
              return base.jsonResponse(listBody());
            }
            started.complete();
            return response.future;
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1');
      await model.loadList();
      final pending = model.openDetail('r1');
      await started.future;
      model.setOwner('u2');
      response.complete(base.jsonResponse({'request': detail()}));
      await pending;
      expect(model.items, isEmpty);
      expect(model.detail, isNull);
      expect(model.selectedId, isNull);
    },
  );

  test(
    'closing a pending detail keeps late result out of navigation state',
    () async {
      final auth = base.FakeAuth()..active = true;
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final model = RequestsModel(
        repository(
          auth,
          MockClient((request) async {
            if (request.url.path == '/api/homeowner/requests') {
              return base.jsonResponse(listBody());
            }
            started.complete();
            return response.future;
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1');
      await model.loadList();
      final pending = model.openDetail('r1');
      await started.future;
      model.closeDetail();
      response.complete(base.jsonResponse({'request': detail()}));
      await pending;
      expect(model.detail, isNull);
      expect(model.selectedId, isNull);
    },
  );
  for (final reason in [
    'wrong_role',
    'hoa_resident',
    'membership_pending',
    'no_profile_location',
    'no_community',
  ]) {
    test(
      'eligibility $reason remains successful list without following actionPath',
      () async {
        final auth = base.FakeAuth()..active = true;
        final paths = <String>[];
        final repo = repository(
          auth,
          MockClient((request) async {
            paths.add(request.url.path);
            return base.jsonResponse(listBody(reason: reason));
          }),
        );
        final result = await repo.loadList();
        expect(result.items, hasLength(1));
        expect(result.eligibilityMessage, 'Coverage must be confirmed.');
        expect(paths, ['/api/homeowner/requests']);
      },
    );
  }
  test('HOA row cannot call neighborhood detail endpoint', () async {
    final auth = base.FakeAuth()..active = true;
    final paths = <String>[];
    final model = RequestsModel(
      repository(
        auth,
        MockClient((request) async {
          paths.add(request.url.path);
          return base.jsonResponse(listBody(rows: [summary(context: 'hoa')]));
        }),
      ),
      onSessionExpired: () {},
    );
    addTearDown(model.dispose);
    model.setOwner('u1');
    await model.loadList();
    await model.openDetail('r1');
    expect(paths, ['/api/homeowner/requests']);
    expect(model.selectedId, isNull);
  });
  test(
    'expired detail clears all requests and signals session expiry once',
    () async {
      final auth = base.FakeAuth()..active = true;
      var expired = 0;
      final model = RequestsModel(
        repository(
          auth,
          MockClient(
            (request) async => request.url.path == '/api/homeowner/requests'
                ? base.jsonResponse(listBody())
                : http.Response('', 401),
          ),
        ),
        onSessionExpired: () {
          expired++;
        },
      );
      addTearDown(model.dispose);
      model.setOwner('u1');
      await model.loadList();
      await model.openDetail('r1');
      expect(expired, 1);
      expect(model.items, isEmpty);
      expect(model.detail, isNull);
      expect(model.selectedId, isNull);
    },
  );
  test(
    'wrong detail ID is rejected rather than displaying another resource',
    () async {
      final auth = base.FakeAuth()..active = true;
      final repo = repository(
        auth,
        MockClient(
          (r) async => base.jsonResponse({'request': detail(id: 'other')}),
        ),
      );
      await expectLater(
        repo.loadDetail('r1'),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    },
  );
  test(
    'list clears old rows while refreshing and can recover after server error',
    () async {
      final auth = base.FakeAuth()..active = true;
      var fail = false;
      final model = RequestsModel(
        repository(
          auth,
          MockClient(
            (r) async =>
                fail ? http.Response('', 500) : base.jsonResponse(listBody()),
          ),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1');
      await model.loadList();
      expect(model.items, hasLength(1));
      fail = true;
      final pending = model.loadList();
      expect(model.listStatus, RequestStatus.loading);
      expect(model.items, isEmpty);
      await pending;
      expect(model.listStatus, RequestStatus.failed);
      fail = false;
      await model.loadList();
      expect(model.listStatus, RequestStatus.ready);
      expect(model.items, hasLength(1));
    },
  );
  test('unscoped requests model performs no request', () async {
    var calls = 0;
    final auth = base.FakeAuth()..active = true;
    final model = RequestsModel(
      repository(
        auth,
        MockClient((r) async {
          calls++;
          return base.jsonResponse(listBody());
        }),
      ),
      onSessionExpired: () {},
    );
    addTearDown(model.dispose);
    await model.loadList();
    await model.openDetail('r1');
    expect(calls, 0);
  });
  for (final role in ['provider', 'hoa_staff', 'admin']) {
    testWidgets('$role has no request navigation or request network call', (
      tester,
    ) async {
      final auth = base.FakeAuth()..active = true;
      final paths = <String>[];
      final vm = home(
        auth,
        MockClient((r) async {
          paths.add(r.url.path);
          return requestsRoute(r, role: role);
        }),
      );
      await render(tester, vm);
      expect(find.text('Requests'), findsNothing);
      expect(vm.canViewRequests, isFalse);
      await vm.openRequests();
      expect(
        paths.where((p) => p.startsWith('/api/homeowner/requests')),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    });
  }
  test(
    'signout clears pending request read and cannot restore navigation',
    () async {
      final auth = base.FakeAuth()..active = true;
      final started = Completer<void>(), response = Completer<http.Response>();
      final vm = home(
        auth,
        MockClient((r) async {
          if (r.url.path == '/api/homeowner/requests') {
            started.complete();
            return response.future;
          }
          return requestsRoute(r);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      final pending = vm.openRequests();
      await started.future;
      await vm.signOut();
      response.complete(base.jsonResponse(listBody()));
      await pending;
      expect(vm.showRequests, isFalse);
      expect(vm.requests.items, isEmpty);
      expect(vm.data, isNull);
    },
  );
  test('request401 resets global home state and detail', () async {
    final auth = base.FakeAuth()..active = true;
    final vm = home(
      auth,
      MockClient(
        (r) async => r.url.path.endsWith('/requests/r1')
            ? http.Response('', 401)
            : requestsRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openRequests();
    await vm.requests.openDetail('r1');
    expect(vm.status, HomeStatus.signedOut);
    expect(vm.data, isNull);
    expect(vm.showRequests, isFalse);
    expect(vm.requests.items, isEmpty);
    expect(vm.requests.detail, isNull);
  });
  testWidgets(
    'list detail and platform back preserve native navigation at200percent',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final auth = base.FakeAuth()..active = true;
      final vm = home(auth, MockClient((r) async => requestsRoute(r)));
      await render(tester, vm);
      await tapAndLoad(tester, find.text('Requests'));
      expect(find.text('Your requests'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('View details'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tapAndLoad(tester, find.text('View details'));
      expect(find.text('Request details'), findsOneWidget);
      expect(find.text('Server-authorized detail'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.requests.selectedId, isNull);
      expect(vm.showRequests, isTrue);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.showRequests, isFalse);
      expect(find.text('Your neighborhood, together.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets('empty list and failed list offer honest recovery', (
    tester,
  ) async {
    final auth = base.FakeAuth()..active = true;
    var failed = true;
    final vm = home(
      auth,
      MockClient(
        (r) async => r.url.path == '/api/homeowner/requests'
            ? (failed
                  ? http.Response('', 500)
                  : base.jsonResponse(listBody(rows: [])))
            : requestsRoute(r),
      ),
    );
    await render(tester, vm);
    await tapAndLoad(tester, find.text('Requests'));
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('No requests yet.'), findsNothing);
    failed = false;
    await tapAndLoad(tester, find.text('Retry'));
    expect(find.text('No requests yet.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
  });
  testWidgets(
    'iOS edge swipe returns from detail and logout removes detail route',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final auth = base.FakeAuth()..active = true;
      final vm = home(auth, MockClient((r) async => requestsRoute(r)));
      await render(tester, vm);
      await tapAndLoad(tester, find.text('Requests'));
      await tester.scrollUntilVisible(
        find.text('View details'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tapAndLoad(tester, find.text('View details'));
      expect(vm.requests.selectedId, 'r1');
      await tester.dragFrom(const Offset(1, 300), const Offset(360, 0));
      await tester.pumpAndSettle();
      expect(vm.requests.selectedId, isNull);
      expect(vm.showRequests, isTrue);
      await tester.runAsync(() => vm.requests.openDetail('r1'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => vm.signOut());
      await tester.pumpAndSettle();
      expect(find.text('Request details'), findsNothing);
      expect(vm.requests.selectedId, isNull);
      expect(vm.showRequests, isFalse);
      expect(find.text('Sign in'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
      debugDefaultTargetPlatformOverride = null;
    },
  );
  test('invalid amount and normalized date are rejected; unknown status is inert text', () {
    for (final payload in [
      summary()..remove('bestBidCents'),
      {...summary(), 'bestBidCents': 'unusable'},
    ]) {
      expect(RequestSummary.fromJson(payload).budgetMaxCents, 12345);
    }
    expect(
      () => RequestSummary.fromJson({...summary(), 'budgetMaxCents': 1.5}),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => RequestDetail.fromJson({
        ...detail(),
        'createdAt': '2026-02-31T12:00:00.000Z',
      }),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      RequestSummary.fromJson({...summary(), 'status': 'future_server_state'})
          .status,
      'future_server_state',
    );
  });
  test(
    '401 then native refresh error clears all protected home and request state',
    () async {
      final auth = FailedRefreshAuth()..active = true;
      final vm = home(
        auth,
        MockClient(
          (r) async => r.url.path.endsWith('/requests/r1')
              ? http.Response('', 401)
              : requestsRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openRequests();
      await vm.requests.openDetail('r1');
      expect(vm.status, HomeStatus.signedOut);
      expect(vm.data, isNull);
      expect(vm.requests.items, isEmpty);
      expect(vm.requests.detail, isNull);
      expect(vm.showRequests, isFalse);
      expect(vm.message, isNot(contains('private SDK')));
    },
  );
  testWidgets(
    'rapid back and reopen same request retains newest detail route',
    (tester) async {
      final auth = base.FakeAuth()..active = true;
      final vm = home(auth, MockClient((r) async => requestsRoute(r)));
      await render(tester, vm);
      await tapAndLoad(tester, find.text('Requests'));
      await tester.runAsync(() => vm.requests.openDetail('r1'));
      await tester.pumpAndSettle();
      vm.requests.closeDetail();
      await tester.pump(const Duration(milliseconds: 20));
      await tester.runAsync(() => vm.requests.openDetail('r1'));
      await tester.pumpAndSettle();
      expect(vm.requests.selectedId, 'r1');
      expect(find.text('Request details'), findsOneWidget);
      expect(vm.requests.detail?.id, 'r1');
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  test(
    'initial token network error does not falsely expire existing account',
    () async {
      final auth = InitialTokenErrorAuth()..active = true;
      final vm = home(auth, MockClient((r) async => requestsRoute(r)));
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openRequests();
      auth.fail = true;
      await vm.requests.openDetail('r1');
      expect(vm.signedIn, isTrue);
      expect(vm.data, isNotNull);
      expect(vm.requests.detail, isNull);
      expect(vm.requests.detailStatus, RequestStatus.failed);
      expect(vm.requests.detailMessage, isNot(contains('private SDK')));
      auth.fail = false;
      await vm.requests.refreshDetail();
      expect(vm.requests.detail?.id, 'r1');
    },
  );
  testWidgets(
    'currency-ambiguous savings and lowest bid stay hidden while USD budget remains',
    (tester) async {
      final vm = home(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/homeowner/requests'
              ? base.jsonResponse(
                  listBody(
                    rows: [
                      {...summary(), 'bestBidCents': 987654},
                    ],
                  ),
                )
              : requestsRoute(r),
        ),
      );
      await render(tester, vm);
      expect(find.textContaining('Recorded savings'), findsNothing);
      expect(find.textContaining('12.50'), findsNothing);
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -1000));
      await tester.pumpAndSettle();
      expect(find.textContaining('Recorded savings'), findsNothing);
      await tapAndLoad(tester, find.text('Requests'));
      await tester.scrollUntilVisible(find.textContaining('123.45 USD'), 200);
      await tester.pumpAndSettle();
      expect(find.textContaining('123.45 USD'), findsOneWidget);
      expect(find.textContaining('Lowest live bid'), findsNothing);
      expect(find.textContaining('9,876.54'), findsNothing);
      expect(find.textContaining('9876.54'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
}
