// Independent source-shaped community fixtures; no live membership proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/community/models.dart';
import 'package:bundleen/features/community/community_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;
import 'account_test.dart' as account;

Map<String, Object?> request({String id = 'r1'}) => {
  'id': id,
  'communityId': 'c1',
  'title': 'Shared garden request',
  'categoryLabel': 'Landscaping',
  'status': 'open_for_bids',
  'createdAt': '2026-11-01T15:00:00.000Z',
  'description': '<b>Shared garden</b>\nhttps://untrusted.example/path',
  'createdByName': 'PRIVATE RESIDENT',
  'permissions': {'canManage': true},
  'participants': [
    {'name': 'PRIVATE PARTICIPANT'},
  ],
  'bids': [
    {'amountCents': 987654, 'providerName': 'PRIVATE PROVIDER'},
  ],
  'myVisits': [
    {'addressLine1': 'PRIVATE ADDRESS', 'accessNotes': 'SECRET CODE'},
  ],
  'agreement': {'scope': 'PRIVATE AGREEMENT'},
  'occurrences': [
    {'private': 'PRIVATE ROUTE'},
  ],
};
Map<String, Object?> hub({List<Map<String, Object?>>? rows}) => {
  'communityId': 'c1',
  'communityName': 'Garden neighborhood',
  'activeNeighbourCount': 24,
  'managerName': 'Taylor Manager',
  'isManager': true,
  'addressReady': true,
  'requests': rows ?? [request()],
};
http.Response communityRoute(
  http.Request r, {
  String role = 'homeowner',
  Map<String, Object?>? data,
}) => r.url.path == '/api/homeowner/neighbourhood'
    ? base.jsonResponse({'hub': data ?? hub()})
    : account.accountRoute(r, role: role);
CommunityRepository repository(base.FakeAuth auth, http.Client client) =>
    CommunityRepository(ApiClient(base.config(), auth, client));
void main() {
  test('hub retains member count and nullable manager not authorityflags', () {
    final v = CommunityHub.fromJson({...hub(), 'managerName': null});
    expect(v.activeNeighbourCount, 24);
    expect(v.managerName, isNull);
    expect(v.requests.single.communityId, 'c1');
  });
  for (final key in [
    'communityId',
    'communityName',
    'activeNeighbourCount',
    'managerName',
    'requests',
  ]) {
    test('required hub$key missing rejected', () {
      final data = hub()..remove(key);
      expect(
        () => CommunityHub.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final key in [
    'id',
    'communityId',
    'title',
    'categoryLabel',
    'status',
    'createdAt',
    'description',
  ]) {
    test('required request$key missing rejected', () {
      final data = request()..remove(key);
      expect(
        () => CommunityRequest.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final count in [-1, 0.5, '24', 9007199254740992]) {
    test('invalid membership count$count fails', () {
      expect(
        () => CommunityHub.fromJson({...hub(), 'activeNeighbourCount': count}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('crosscommunity,duplicate,over50 requests fail', () {
    expect(
      () => CommunityHub.fromJson(
        hub(
          rows: [
            {...request(), 'communityId': 'other'},
          ],
        ),
      ),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => CommunityHub.fromJson(hub(rows: [request(), request()])),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => CommunityHub.fromJson(
        hub(rows: List.generate(51, (i) => request(id: 'r$i'))),
      ),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      CommunityHub.fromJson(
        hub(rows: List.generate(50, (i) => request(id: 'r$i'))),
      ).requests,
      hasLength(50),
    );
  });
  test('unknown status inert and strict canonical date', () {
    expect(
      CommunityRequest.fromJson({...request(), 'status': 'future_status'})
          .status,
      'future_status',
    );
    expect(
      () => CommunityRequest.fromJson({
        ...request(),
        'createdAt': '2026-02-31T15:00:00.000Z',
      }),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('canonicalBritish GET null hub distinct from emptyhub', () async {
    var absent = true;
    final calls = <http.Request>[];
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        calls.add(r);
        return base.jsonResponse({'hub': absent ? null : hub(rows: [])});
      }),
    );
    expect(await repo.load(), isNull);
    absent = false;
    final v = await repo.load();
    expect(v, isNotNull);
    expect(v!.requests, isEmpty);
    expect(calls.map((r) => r.method), everyElement('GET'));
    expect(
      calls.map((r) => r.url.path),
      everyElement('/api/homeowner/neighbourhood'),
    );
    expect(calls.every((r) => r.url.query.isEmpty), isTrue);
  });
  for (final role in [
    'homeowner',
    'provider',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role lazy Community productgate', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return communityRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      expect(calls.where((p) => p == '/api/homeowner/neighbourhood'), isEmpty);
      await vm.openCommunity();
      expect(
        calls.where((p) => p == '/api/homeowner/neighbourhood').length,
        role == 'homeowner' ? 1 : 0,
      );
      expect(calls.where((p) => p.contains('managed-communities')), isEmpty);
      expect(calls.where((p) => p.contains('/neighbourhood/')), isEmpty);
    });
  }
  for (final code in [403, 409, 500]) {
    test('hub$code preserves Account with retry', () async {
      var failed = true;
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/homeowner/neighbourhood' && failed
              ? http.Response('', code)
              : communityRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openCommunity();
      expect(vm.community.status, CommunityStatus.failed);
      expect(vm.canViewAccount, isTrue);
      await vm.openAccount();
      expect(vm.account.profile, isNotNull);
      failed = false;
      await vm.openCommunity();
      await vm.community.load();
      expect(vm.community.hub, isNotNull);
    });
  }
  test(
    'refresh revoked null discards previoushub and expandeddescription',
    () async {
      var revoke = false;
      final response = Completer<http.Response>();
      final vm = CommunityModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) async => revoke ? response.future : communityRoute(r)),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      await vm.load();
      vm.toggleExpanded('r1');
      revoke = true;
      final pending = vm.load();
      expect(vm.hub, isNull);
      expect(vm.expandedId, isNull);
      response.complete(base.jsonResponse({'hub': null}));
      await pending;
      expect(vm.status, CommunityStatus.ready);
      expect(vm.hub, isNull);
    },
  );
  for (final action in ['clear', 'owner', 'close']) {
    test('latehub after$action ignored', () async {
      final response = Completer<http.Response>();
      final vm = CommunityModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) => response.future),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      final load = vm.load();
      if (action == 'clear') {
        vm.clear();
      } else if (action == 'owner') {
        vm.setOwner('u2');
      } else {
        vm.close();
      }
      response.complete(base.jsonResponse({'hub': hub()}));
      await load;
      expect(vm.hub, isNull);
    });
  }
  test('oversizedhub safe failure keeps Account', () async {
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/homeowner/neighbourhood'
            ? base.jsonResponse({
                'hub': {...hub(), 'private': 'x' * (1024 * 1024)},
              })
            : communityRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openCommunity();
    expect(vm.community.status, CommunityStatus.failed);
    expect(vm.community.hub, isNull);
    expect(vm.canViewAccount, isTrue);
  });
  test('hub timeout is recoverable failure not emptysuccess', () async {
    final repo = CommunityRepository(
      ApiClient(
        base.config(),
        base.FakeAuth()..active = true,
        MockClient((r) => Completer<http.Response>().future),
        timeout: const Duration(milliseconds: 10),
      ),
    );
    final vm = CommunityModel(repo, onSessionExpired: () {});
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    expect(vm.status, CommunityStatus.failed);
    expect(vm.hub, isNull);
  });
  test('401forcedrenewal globally clears hub', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/homeowner/neighbourhood'
            ? http.Response('', 401)
            : communityRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openCommunity();
    expect(vm.signedIn, isFalse);
    expect(vm.community.hub, isNull);
    expect(vm.canViewAccount, isFalse);
  });
  testWidgets(
    'fourtab200percent inlineplaintext managerflagsgrantnoactions and back',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final calls = <http.Request>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r);
          return communityRoute(r);
        }),
      );
      await fixtures.render(tester, vm);
      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Requests'), findsOneWidget);
      expect(find.text('Community'), findsOneWidget);
      expect(find.text('Account'), findsOneWidget);
      await fixtures.tapAndLoad(tester, find.text('Community'));
      await tester.scrollUntilVisible(find.text('Show description'), 400);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show description'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('<b>Shared garden</b>\nhttps://untrusted.example/path'),
        400,
      );
      await tester.pumpAndSettle();
      final count = calls.length;
      await tester.tap(
        find.text('<b>Shared garden</b>\nhttps://untrusted.example/path'),
      );
      await tester.pumpAndSettle();
      expect(calls, hasLength(count));
      expect(find.textContaining('PRIVATE'), findsNothing);
      expect(find.textContaining('SECRET'), findsNothing);
      expect(find.text('Manage community'), findsNothing);
      expect(calls.map((r) => r.method), everyElement('GET'));
      expect(tester.takeException(), isNull);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.showCommunity, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  test('latehub after rolechange cannot repopulate new Home', () async {
    var role = 'homeowner';
    final response = Completer<http.Response>();
    final started = Completer<void>();
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        if (r.url.path == '/api/homeowner/neighbourhood') {
          started.complete();
          return response.future;
        }
        return communityRoute(r, role: role);
      }),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    final pending = vm.openCommunity();
    await started.future;
    role = 'hoa_staff';
    await vm.refresh();
    response.complete(base.jsonResponse({'hub': hub()}));
    await pending;
    expect(vm.community.hub, isNull);
    expect(vm.showCommunity, isFalse);
    expect(vm.canViewCommunity, isFalse);
    expect(vm.canViewAccount, isTrue);
  });
  test('latehub after signout discarded', () async {
    final response = Completer<http.Response>();
    final started = Completer<void>();
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        if (r.url.path == '/api/homeowner/neighbourhood') {
          started.complete();
          return response.future;
        }
        return communityRoute(r);
      }),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    final pending = vm.openCommunity();
    await started.future;
    await vm.signOut();
    response.complete(base.jsonResponse({'hub': hub()}));
    await pending;
    expect(vm.community.hub, isNull);
    expect(vm.showCommunity, isFalse);
  });
  test('late oldowner401 cannot expire current scope', () async {
    final response = Completer<http.Response>();
    var expired = 0;
    final vm = CommunityModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => response.future),
      ),
      onSessionExpired: () => expired++,
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final pending = vm.load();
    vm.setOwner('u2');
    response.complete(http.Response('', 401));
    await pending;
    expect(expired, 0);
    expect(vm.hub, isNull);
  });
}
