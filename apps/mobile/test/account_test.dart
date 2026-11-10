// Independent synthetic API/channel fixtures; never live auth or device proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/account/models.dart';
import 'package:bundleen/features/account/account_model.dart';
import 'package:bundleen/core/ui/date_label.dart';
import 'package:bundleen/features/requests/requests_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as request_fixtures;

Map<String, Object?> accountProfile({
  String id = 'u1',
  String role = 'homeowner',
  bool verified = true,
}) => {
  'id': id,
  'email': 'resident@example.test',
  'fullName': 'Test Resident',
  'role': role,
  'isVerified': verified,
  'phone': null,
  'address': null,
  'neighborhood': null,
  'latitude': null,
  'longitude': null,
  'avatarUrl': null,
  'avatarUpdatedAt': null,
  'createdAt': '2024-01-04T15:00:00.000Z',
  'communityRadiusMi': 5,
};
Map<String, Object?> notification({
  String id = 'n1',
  bool read = false,
  String? link = '/app/admin',
}) => {
  'id': id,
  'kind': 'future_kind',
  'title': 'A neighborhood update',
  'body': '<b>Plain text</b> only. Review your community updates.',
  'linkPath': link,
  'readAt': read ? '2026-11-01T16:00:00.000Z' : null,
  'createdAt': '2026-11-01T15:00:00.000Z',
};
http.Response accountRoute(
  http.Request r, {
  String role = 'homeowner',
  List<Map<String, Object?>>? items,
}) => switch (r.url.path) {
  '/api/profile' => base.jsonResponse(accountProfile(role: role)),
  '/api/me/context' => base.jsonResponse(base.context(role)),
  '/api/homeowner/dashboard' => base.jsonResponse(base.dashboard()),
  '/api/me/notifications' => base.jsonResponse({
    'notifications':
        items ??
        [
          notification(),
          notification(id: 'n2', read: true, link: 'javascript:alert(1)'),
        ],
  }),
  _ => http.Response('', 404),
};
AccountRepository accountRepository(base.FakeAuth auth, http.Client client) =>
    AccountRepository(ApiClient(base.config(), auth, client));

void main() {
  test(
    'profile direct payload retains email verification and nullable fields',
    () {
      final profile = AccountProfile.fromJson(accountProfile());
      expect(profile.email, 'resident@example.test');
      expect(profile.isVerified, isTrue);
      expect(profile.phone, isNull);
      expect(profile.address, isNull);
      expect(profile.neighborhood, isNull);
      expect(profile.createdAt.year, 2024);
      expect(
        () => AccountProfile.fromJson({'profile': accountProfile()}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
      expect(
        () =>
            AccountProfile.fromJson({...accountProfile(), 'isVerified': 'yes'}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    },
  );
  test('notifications preserve unknown kind and server readAt without interpreting link/body', () {
    final unread = NotificationItem.fromJson(
      notification(link: '//evil.example'),
    );
    final read = NotificationItem.fromJson(
      notification(read: true, link: null),
    );
    expect(unread.kind, 'future_kind');
    expect(unread.readAt, isNull);
    expect(unread.body, contains('<b>'));
    expect(read.readAt, isNotNull);
    expect(read.linkPath, isNull);
    expect(
      () => NotificationItem.fromJson({
        ...notification(),
        'createdAt': '2026-02-31T15:00:00.000Z',
      }),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final mismatch in ['id', 'role']) {
    test('fresh account response $mismatch mismatch fails closed', () async {
      final auth = base.FakeAuth()..active = true;
      final repo = accountRepository(
        auth,
        MockClient(
          (r) async => base.jsonResponse({
            ...accountProfile(),
            mismatch: mismatch == 'id' ? 'other' : 'provider',
          }),
        ),
      );
      await expectLater(
        repo.loadProfile('u1', 'homeowner'),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('all collection interactions remain GET only with exact routes and no owner query', () async {
    final calls = <http.Request>[];
    final auth = base.FakeAuth()..active = true;
    final model = AccountModel(
      accountRepository(
        auth,
        MockClient((r) async {
          calls.add(r);
          return accountRoute(r);
        }),
      ),
      onSessionExpired: () {},
    );
    addTearDown(model.dispose);
    model.setOwner('u1', 'homeowner');
    await model.loadProfile();
    await model.openNotifications();
    await model.loadNotifications();
    expect(calls.map((r) => r.method), everyElement('GET'));
    expect(calls.every((r) => r.url.query.isEmpty), isTrue);
    expect(calls.map((r) => r.url.path), [
      '/api/profile',
      '/api/me/notifications',
      '/api/me/notifications',
    ]);
    expect(model.notifications.first.readAt, isNull);
    expect(model.notifications.last.readAt, isNotNull);
    model.closeNotifications();
    expect(model.notifications, isEmpty);
  });
  for (final code in [303, 403, 500]) {
    test(
      'notification $code does not expose old data and permits retry',
      () async {
        final auth = base.FakeAuth()..active = true;
        var failing = false;
        var expired = 0;
        final model = AccountModel(
          accountRepository(
            auth,
            MockClient(
              (r) async => failing && r.url.path == '/api/me/notifications'
                  ? http.Response(
                      '',
                      code,
                      headers: {'location': 'https://evil.example'},
                    )
                  : accountRoute(r),
            ),
          ),
          onSessionExpired: () {
            expired++;
          },
        );
        addTearDown(model.dispose);
        model.setOwner('u1', 'homeowner');
        await model.loadProfile();
        await model.openNotifications();
        expect(model.notifications, isNotEmpty);
        failing = true;
        await model.loadNotifications();
        expect(model.notifications, isEmpty);
        expect(model.notificationsStatus, AccountStatus.failed);
        expect(expired, 0);
        failing = false;
        await model.loadNotifications();
        expect(model.notificationsStatus, AccountStatus.ready);
      },
    );
  }
  test('notification401 clears profile/list and signals expiration', () async {
    final auth = base.FakeAuth()..active = true;
    var expired = 0;
    final model = AccountModel(
      accountRepository(
        auth,
        MockClient(
          (r) async => r.url.path == '/api/me/notifications'
              ? http.Response('', 401)
              : accountRoute(r),
        ),
      ),
      onSessionExpired: () {
        expired++;
      },
    );
    addTearDown(model.dispose);
    model.setOwner('u1', 'homeowner');
    await model.loadProfile();
    await model.openNotifications();
    expect(expired, 1);
    expect(model.profile, isNull);
    expect(model.notifications, isEmpty);
    expect(model.showingNotifications, isFalse);
  });
  test('late notification response cannot cross owner switch', () async {
    final auth = base.FakeAuth()..active = true;
    final started = Completer<void>(), response = Completer<http.Response>();
    final model = AccountModel(
      accountRepository(
        auth,
        MockClient((r) async {
          if (r.url.path == '/api/me/notifications') {
            started.complete();
            return response.future;
          }
          return accountRoute(r);
        }),
      ),
      onSessionExpired: () {},
    );
    addTearDown(model.dispose);
    model.setOwner('u1', 'homeowner');
    await model.loadProfile();
    final pending = model.openNotifications();
    await started.future;
    model.setOwner('u2', 'homeowner');
    response.complete(
      base.jsonResponse({
        'notifications': [notification()],
      }),
    );
    await pending;
    expect(model.profile, isNull);
    expect(model.notifications, isEmpty);
    expect(model.showingNotifications, isFalse);
  });
  test(
    'late account response after clear cannot restore private profile',
    () async {
      final auth = base.FakeAuth()..active = true;
      final started = Completer<void>(), response = Completer<http.Response>();
      final model = AccountModel(
        accountRepository(
          auth,
          MockClient((r) async {
            started.complete();
            return response.future;
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1', 'homeowner');
      final pending = model.loadProfile();
      await started.future;
      model.clear();
      response.complete(base.jsonResponse(accountProfile()));
      await pending;
      expect(model.profile, isNull);
    },
  );
  for (final role in ['admin', 'future_role']) {
    test('$role never issues Account or notifications requests', () async {
      var calls = 0;
      final auth = base.FakeAuth()..active = true;
      final model = AccountModel(
        accountRepository(
          auth,
          MockClient((r) async {
            calls++;
            return accountRoute(r);
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1', role);
      await model.loadProfile();
      await model.openNotifications();
      await model.loadNotifications();
      expect(calls, 0);
      expect(model.profile, isNull);
      expect(model.notifications, isEmpty);
    });
  }
  for (final code in [403, 404, 409, 500]) {
    test(
      'profile$code prevents notifications and recovers from error',
      () async {
        var failure = true;
        final calls = <String>[];
        final auth = base.FakeAuth()..active = true;
        final model = AccountModel(
          accountRepository(
            auth,
            MockClient((r) async {
              calls.add(r.url.path);
              return failure ? http.Response('', code) : accountRoute(r);
            }),
          ),
          onSessionExpired: () {},
        );
        addTearDown(model.dispose);
        model.setOwner('u1', 'homeowner');
        await model.loadProfile();
        await model.openNotifications();
        expect(model.profileStatus, AccountStatus.failed);
        expect(model.profile, isNull);
        expect(calls, ['/api/profile']);
        failure = false;
        await model.loadProfile();
        expect(model.profileStatus, AccountStatus.ready);
      },
    );
  }
  test(
    'recent collection preserves all30 items and read status without totals',
    () async {
      final rows = List.generate(
        30,
        (i) => notification(id: 'n$i', read: i.isEven),
      );
      final auth = base.FakeAuth()..active = true;
      final repo = accountRepository(
        auth,
        MockClient((r) async => accountRoute(r, items: rows)),
      );
      final results = await repo.loadNotifications();
      expect(results, hasLength(30));
      expect(results.first.id, 'n0');
      expect(results.last.id, 'n29');
      expect(results.first.readAt, isNotNull);
      expect(results.last.readAt, isNull);
    },
  );
  test(
    'closing notifications during request discards eventual response',
    () async {
      final started = Completer<void>(), response = Completer<http.Response>();
      final auth = base.FakeAuth()..active = true;
      final model = AccountModel(
        accountRepository(
          auth,
          MockClient((r) async {
            if (r.url.path == '/api/me/notifications') {
              started.complete();
              return response.future;
            }
            return accountRoute(r);
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(model.dispose);
      model.setOwner('u1', 'homeowner');
      await model.loadProfile();
      final pending = model.openNotifications();
      await started.future;
      model.closeNotifications();
      response.complete(
        base.jsonResponse({
          'notifications': [notification()],
        }),
      );
      await pending;
      expect(model.showingNotifications, isFalse);
      expect(model.notifications, isEmpty);
    },
  );
  testWidgets(
    'shared account and request date labels include year and UTC offset',
    (tester) async {
      final instant = DateTime.parse('2024-01-04T15:00:00.000Z');
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Column(
              children: [
                Text(localInstantLabel(context, instant)),
                Text(requestDateLabel(context, instant)),
              ],
            ),
          ),
        ),
      );
      expect(find.textContaining('2024'), findsNWidgets(2));
      expect(
        find.textContaining(RegExp(r'UTC[+-]\d{2}:\d{2}')),
        findsNWidgets(2),
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
  for (final role in ['homeowner', 'provider', 'hoa_staff']) {
    testWidgets(
      '$role gets Account navigation with precise email verification',
      (tester) async {
        final auth = base.FakeAuth()..active = true;
        final calls = <http.Request>[];
        final vm = request_fixtures.home(
          auth,
          MockClient((r) async {
            calls.add(r);
            return accountRoute(r, role: role);
          }),
        );
        await request_fixtures.render(tester, vm);
        expect(find.text('Account'), findsOneWidget);
        expect(
          find.text('Requests'),
          role == 'homeowner' ? findsOneWidget : findsNothing,
        );
        await request_fixtures.tapAndLoad(tester, find.text('Account'));
        expect(find.text('Email verification'), findsOneWidget);
        expect(find.text('Verified'), findsOneWidget);
        expect(find.textContaining('provider verified'), findsNothing);
        await tester.scrollUntilVisible(
          find.text('Neighborhood on profile'),
          200,
        );
        expect(find.text('Not provided'), findsWidgets);
        expect(calls.map((r) => r.method), everyElement('GET'));
        await tester.pumpWidget(const SizedBox());
        vm.dispose();
      },
    );
  }
  for (final role in ['admin', 'future_role']) {
    testWidgets('$role gets no public Account navigation', (tester) async {
      final auth = base.FakeAuth()..active = true;
      final calls = <http.Request>[];
      final vm = request_fixtures.home(
        auth,
        MockClient((r) async {
          calls.add(r);
          return accountRoute(r, role: role);
        }),
      );
      await request_fixtures.render(tester, vm);
      expect(find.text('Account'), findsNothing);
      expect(vm.canViewAccount, isFalse);
      final count = calls.length;
      await vm.openAccount();
      expect(calls, hasLength(count));
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    });
  }
  testWidgets(
    'notifications remain text only, preserve read state and navigate back at200percent',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final auth = base.FakeAuth()..active = true;
      final calls = <http.Request>[];
      final vm = request_fixtures.home(
        auth,
        MockClient((r) async {
          calls.add(r);
          return accountRoute(r);
        }),
      );
      await request_fixtures.render(tester, vm);
      await request_fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.scrollUntilVisible(
        find.text('Recent notifications'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await request_fixtures.tapAndLoad(
        tester,
        find.text('Recent notifications'),
      );
      expect(vm.account.showingNotifications, isTrue);
      expect(tester.takeException(), isNull);
      expect(find.textContaining('Up to 30'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('<b>Plain text</b> only. Review your community updates.'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      final before = calls.length;
      await tester.tap(
        find
            .text('<b>Plain text</b> only. Review your community updates.')
            .first,
      );
      await tester.pumpAndSettle();
      expect(calls, hasLength(before));
      expect(vm.account.notifications.first.readAt, isNull);
      expect(vm.account.notifications.last.readAt, isNotNull);
      expect(find.text('javascript:alert(1)'), findsNothing);
      expect(calls.map((r) => r.method), everyElement('GET'));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.account.showingNotifications, isFalse);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.showAccount, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets('iOS notification edge-swipe and signout remove nested route', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final auth = base.FakeAuth()..active = true;
    final vm = request_fixtures.home(
      auth,
      MockClient((r) async => accountRoute(r)),
    );
    await request_fixtures.render(tester, vm);
    await request_fixtures.tapAndLoad(tester, find.text('Account'));
    await tester.runAsync(() => vm.account.openNotifications());
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(1, 300), const Offset(750, 0));
    await tester.pumpAndSettle();
    expect(vm.account.showingNotifications, isFalse);
    await tester.runAsync(() => vm.account.openNotifications());
    await tester.pumpAndSettle();
    await tester.runAsync(() => vm.signOut());
    await tester.pumpAndSettle();
    expect(vm.account.profile, isNull);
    expect(vm.account.notifications, isEmpty);
    expect(find.text('Recent notifications'), findsNothing);
    expect(find.text('Sign in'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
  test(
    'notification401 then failed forced renewal clears global Account state',
    () async {
      final auth = request_fixtures.FailedRefreshAuth()..active = true;
      final vm = request_fixtures.home(
        auth,
        MockClient(
          (r) async => r.url.path == '/api/me/notifications'
              ? http.Response('', 401)
              : accountRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      await vm.account.openNotifications();
      expect(vm.signedIn, isFalse);
      expect(vm.data, isNull);
      expect(vm.showAccount, isFalse);
      expect(vm.account.profile, isNull);
      expect(vm.account.notifications, isEmpty);
    },
  );
  testWidgets('empty notifications and recoverable denial are not conflated', (
    tester,
  ) async {
    var denied = true;
    final auth = base.FakeAuth()..active = true;
    final vm = request_fixtures.home(
      auth,
      MockClient(
        (r) async => r.url.path == '/api/me/notifications'
            ? (denied
                  ? http.Response('', 403)
                  : base.jsonResponse({'notifications': []}))
            : accountRoute(r),
      ),
    );
    await request_fixtures.render(tester, vm);
    await request_fixtures.tapAndLoad(tester, find.text('Account'));
    await tester.runAsync(() => vm.account.openNotifications());
    await tester.pumpAndSettle();
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('No recent notifications.'), findsNothing);
    denied = false;
    await request_fixtures.tapAndLoad(tester, find.text('Retry'));
    expect(find.text('No recent notifications.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
  });
}
