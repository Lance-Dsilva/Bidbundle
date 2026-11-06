// Independent synthetic coverage fixtures; not live ownership/device evidence.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/service_areas/models.dart';
import 'package:bundleen/features/service_areas/service_areas_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;
import 'support_test.dart' as support;

Map<String, Object?> area({String id = 'a1'}) => {
  'id': id,
  'label': '<b>North service area</b>',
  'isPrimary': true,
  'locality': 'Garden town',
  'region': 'NY',
  'radiusMiles': 12.5,
  'postalCodes': ['10001', '10002'],
  'status': 'active',
  'updatedAt': '2026-11-01T15:00:00.000Z',
  'centerLatitude': 40.123456,
  'centerLongitude': -74.123456,
  'formattedAddress': 'PRIVATE BUSINESS ADDRESS',
  'postalCode': 'PRIVATE POSTAL',
  'countryCode': 'US',
  'createdAt': '2025-01-01T12:00:00.000Z',
};
http.Response coverageRoute(
  http.Request r, {
  String role = 'provider',
  List<Map<String, Object?>>? rows,
}) => r.url.path == '/api/provider/service-areas'
    ? base.jsonResponse({
        'areas': rows ?? [area()],
      })
    : support.supportRoute(r, role: role);
ServiceAreasRepository repository(base.FakeAuth auth, http.Client client) =>
    ServiceAreasRepository(ApiClient(base.config(), auth, client));
void main() {
  test('nullable legacy radius coarse location and postal list retained', () {
    final v = ServiceArea.fromJson({
      ...area(),
      'radiusMiles': null,
      'locality': null,
      'region': null,
    });
    expect(v.radiusMiles, isNull);
    expect(v.locality, isNull);
    expect(v.region, isNull);
    expect(v.postalCodes, ['10001', '10002']);
  });
  for (final key in [
    'id',
    'label',
    'isPrimary',
    'locality',
    'region',
    'radiusMiles',
    'postalCodes',
    'status',
    'updatedAt',
  ]) {
    test('required $key missing fails', () {
      final data = area()..remove(key);
      expect(
        () => ServiceArea.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final value in [0, 0.9, 100.1, double.infinity, double.nan, '15']) {
    test('invalid radius$value fails', () {
      expect(
        () => ServiceArea.fromJson({...area(), 'radiusMiles': value}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final value in [1, 100, 12.5]) {
    test('bounded radius$value valid', () {
      expect(
        ServiceArea.fromJson({...area(), 'radiusMiles': value}).radiusMiles,
        value,
      );
    });
  }
  for (final change in [
    {'status': 'removed'},
    {'status': 'unknown'},
    {'postalCodes': null},
    {
      'postalCodes': [123],
    },
    {'isPrimary': 'true'},
    {'updatedAt': '2026-02-31T15:00:00.000Z'},
  ]) {
    test('invalid coverage$change fails', () {
      expect(
        () => ServiceArea.fromJson({...area(), ...change}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('canonicalGET keeps over10rows and no primary assumption', () async {
    final calls = <http.Request>[];
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        calls.add(r);
        return coverageRoute(
          r,
          rows: List.generate(
            12,
            (i) => {...area(id: 'a$i'), 'isPrimary': false},
          ),
        );
      }),
    );
    expect(await repo.load(), hasLength(12));
    expect(calls.single.method, 'GET');
    expect(calls.single.url.path, '/api/provider/service-areas');
    expect(calls.single.url.query, isEmpty);
    expect(calls.single.body, isEmpty);
  });
  for (final role in [
    'provider',
    'homeowner',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role lazy service areas gate', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return coverageRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      expect(calls.where((p) => p.contains('service-areas')), isEmpty);
      await vm.openAccount();
      expect(calls.where((p) => p.contains('service-areas')), isEmpty);
      await vm.account.openServiceAreas();
      expect(
        calls.where((p) => p == '/api/provider/service-areas').length,
        role == 'provider' ? 1 : 0,
      );
      expect(calls.where((p) => p.contains('/marketplace')), isEmpty);
    });
  }
  for (final code in [403, 409, 500]) {
    test('coverage$code preserves Account and retries', () async {
      var failed = true;
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/service-areas' && failed
              ? http.Response('', code)
              : coverageRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      await vm.account.openServiceAreas();
      expect(vm.serviceAreas.status, ServiceAreasStatus.failed);
      expect(vm.account.profile, isNotNull);
      expect(vm.canViewAccount, isTrue);
      failed = false;
      await vm.serviceAreas.load();
      expect(vm.serviceAreas.items, hasLength(1));
    });
  }
  test('empty read remains ready and does not imply eligibility', () async {
    final vm = ServiceAreasModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) async => coverageRoute(r, rows: [])),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    expect(vm.status, ServiceAreasStatus.ready);
    expect(vm.items, isEmpty);
  });
  for (final action in ['clear', 'owner', 'close']) {
    test('late service area after$action discarded', () async {
      final response = Completer<http.Response>();
      final vm = ServiceAreasModel(
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
      response.complete(
        base.jsonResponse({
          'areas': [area()],
        }),
      );
      await load;
      expect(vm.items, isEmpty);
    });
  }
  test('refresh clears old rows immediately then replaces', () async {
    var refresh = false;
    final response = Completer<http.Response>();
    final vm = ServiceAreasModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) async => refresh ? response.future : coverageRoute(r)),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    refresh = true;
    final load = vm.load();
    expect(vm.items, isEmpty);
    expect(vm.status, ServiceAreasStatus.loading);
    response.complete(base.jsonResponse({'areas': []}));
    await load;
    expect(vm.status, ServiceAreasStatus.ready);
  });
  test('1MiB fails preserving Account', () async {
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/service-areas'
            ? base.jsonResponse({
                'areas': [
                  {...area(), 'formattedAddress': 'x' * (1024 * 1024)},
                ],
              })
            : coverageRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openServiceAreas();
    expect(vm.serviceAreas.status, ServiceAreasStatus.failed);
    expect(vm.account.profile, isNotNull);
  });
  test('401failed renewal clears global coverage', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/service-areas'
            ? http.Response('', 401)
            : coverageRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openServiceAreas();
    expect(vm.signedIn, isFalse);
    expect(vm.serviceAreas.items, isEmpty);
    expect(vm.account.profile, isNull);
  });
  testWidgets(
    '200percent plain coverage with private fields absent back and route switches',
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
          return coverageRoute(r);
        }),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.scrollUntilVisible(find.text('Service areas'), 400);
      await tester.pumpAndSettle();
      await fixtures.tapAndLoad(tester, find.text('Service areas'));
      await tester.scrollUntilVisible(
        find.text('<b>North service area</b>'),
        400,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('PRIVATE'), findsNothing);
      expect(find.textContaining('40.123456'), findsNothing);
      expect(calls.map((r) => r.method), everyElement('GET'));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.account.showingServiceAreas, isFalse);
      await tester.runAsync(() => vm.account.openServiceAreas());
      await tester.pumpAndSettle();
      await tester.runAsync(() => vm.account.openSupport());
      await tester.pump();
      await tester.runAsync(() => vm.account.openNotifications());
      await tester.pump();
      await tester.runAsync(() => vm.account.openServiceAreas());
      await tester.pumpAndSettle();
      expect(vm.account.showingServiceAreas, isTrue);
      expect(vm.account.showingSupport, isFalse);
      expect(vm.account.showingNotifications, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets('iOS coverage edge swipe then logout removes route', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async => coverageRoute(r)),
    );
    await fixtures.render(tester, vm);
    await fixtures.tapAndLoad(tester, find.text('Account'));
    await tester.runAsync(() => vm.account.openServiceAreas());
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(1, 300), const Offset(750, 0));
    await tester.pumpAndSettle();
    expect(vm.account.showingServiceAreas, isFalse);
    await tester.runAsync(() => vm.account.openServiceAreas());
    await tester.pumpAndSettle();
    await tester.runAsync(() => vm.signOut());
    await tester.pumpAndSettle();
    expect(vm.serviceAreas.items, isEmpty);
    expect(find.text('Sign in'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
}
