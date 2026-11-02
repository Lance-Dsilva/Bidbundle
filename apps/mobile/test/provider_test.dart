// Independent source-shaped fixtures; no live provider/session proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/provider/models.dart';
import 'package:bundleen/features/provider/provider_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'account_test.dart' as account;
import 'requests_test.dart' as fixtures;

Map<String, Object?> overview({String status = 'active'}) => {
  'companyName': 'Garden Partners',
  'accountStatus': status,
  'activeBids': 3,
  'jobsCompleted': 12,
  'activeJobs': 2,
  'reviewsCount': 4,
  'winRatePct': 75,
  'averageRating': 4.5,
};
http.Response providerRoute(
  http.Request r, {
  String role = 'provider',
  Map<String, Object?>? data,
}) => r.url.path == '/api/provider/overview'
    ? base.jsonResponse({'overview': data ?? overview()})
    : account.accountRoute(r, role: role);
ProviderRepository repository(base.FakeAuth auth, http.Client client) =>
    ProviderRepository(ApiClient(base.config(), auth, client));
void main() {
  for (final status in ['pending', 'active', 'suspended']) {
    test('accepts read-only $status overview', () {
      final value = ProviderOverview.fromJson(overview(status: status));
      expect(value.activeBids, 3);
      expect(value.jobsCompleted, 12);
    });
  }
  test('nullable values differ from real zero rate', () {
    final absent = ProviderOverview.fromJson({
      ...overview(),
      'companyName': null,
      'winRatePct': null,
      'averageRating': null,
    });
    expect(absent.companyName, isNull);
    expect(absent.winRatePct, isNull);
    expect(absent.averageRating, isNull);
    expect(
      ProviderOverview.fromJson({...overview(), 'winRatePct': 0}).winRatePct,
      0,
    );
  });
  for (final key in overview().keys) {
    test('missing required $key rejected', () {
      final body = overview()..remove(key);
      expect(
        () => ProviderOverview.fromJson(body),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final entry in <String, List<Object?>>{
    'accountStatus': ['unknown', null],
    'activeBids': [-1, 1.5, 9007199254740992],
    'jobsCompleted': [-1],
    'activeJobs': [-1],
    'reviewsCount': [-1],
    'winRatePct': [-1, 101, 0.5],
    'averageRating': [0, 5.1, double.nan, double.infinity],
  }.entries) {
    for (final invalid in entry.value) {
      test('rejects ${entry.key}=$invalid', () {
        expect(
          () => ProviderOverview.fromJson({...overview(), entry.key: invalid}),
          throwsA(base.failure(FailureKind.invalidResponse)),
        );
      });
    }
  }
  test('repository exact GET envelope and no client identity', () async {
    final calls = <http.Request>[];
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        calls.add(r);
        return providerRoute(r);
      }),
    );
    await repo.loadOverview();
    expect(calls.single.method, 'GET');
    expect(calls.single.url.path, '/api/provider/overview');
    expect(calls.single.url.query, isEmpty);
    expect(calls.single.body, isEmpty);
    final bad = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async => base.jsonResponse(overview())),
    );
    await expectLater(
      bad.loadOverview(),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final role in [
    'provider',
    'homeowner',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role endpoint isolation', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return providerRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      expect(
        calls.where((p) => p == '/api/provider/overview').length,
        role == 'provider' ? 1 : 0,
      );
      if (role == 'provider') {
        expect(calls.where((p) => p.startsWith('/api/homeowner/')), isEmpty);
      }
    });
  }
  for (final code in [403, 409, 500]) {
    test('provider $code retains Account and retries', () async {
      var failed = true;
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/overview' && failed
              ? http.Response('<html>failure</html>', code)
              : providerRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      expect(vm.canViewAccount, isTrue);
      expect(vm.provider.overview, isNull);
      expect(vm.provider.status, ProviderStatus.failed);
      await vm.openAccount();
      expect(vm.account.profile, isNotNull);
      failed = false;
      await vm.provider.load();
      expect(vm.provider.status, ProviderStatus.ready);
    });
  }
  test('late provider response after signout discarded', () async {
    final started = Completer<void>();
    final response = Completer<http.Response>();
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        if (r.url.path == '/api/provider/overview') {
          started.complete();
          return response.future;
        }
        return providerRoute(r);
      }),
    );
    addTearDown(vm.dispose);
    final pending = vm.initialize();
    await started.future;
    await vm.signOut();
    response.complete(base.jsonResponse({'overview': overview()}));
    await pending;
    expect(vm.provider.overview, isNull);
    expect(vm.canViewAccount, isFalse);
  });
  test('late owner response discarded', () async {
    final pending = Completer<http.Response>();
    final vm = ProviderModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => pending.future),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final load = vm.load();
    vm.setOwner('u2');
    pending.complete(base.jsonResponse({'overview': overview()}));
    await load;
    expect(vm.overview, isNull);
  });
  test('401 forced renewal failure globally clears provider', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/overview'
            ? http.Response('', 401)
            : providerRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    expect(vm.signedIn, isFalse);
    expect(vm.provider.overview, isNull);
    expect(vm.account.profile, isNull);
    expect(vm.canViewAccount, isFalse);
  });
  testWidgets('provider200percent can scroll and reach Account', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async => providerRoute(r)),
    );
    await fixtures.render(tester, vm);
    expect(find.text('Requests'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -1000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await fixtures.tapAndLoad(tester, find.text('Account'));
    expect(vm.account.profile, isNotNull);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
  });
  test('malformed success clears old overview and retries', () async {
    var bad = false;
    final vm = ProviderModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => base.jsonResponse({
            'overview': bad ? {'accountStatus': 'active'} : overview(),
          }),
        ),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    expect(vm.overview, isNotNull);
    bad = true;
    await vm.load();
    expect(vm.overview, isNull);
    expect(vm.status, ProviderStatus.failed);
    bad = false;
    await vm.load();
    expect(vm.status, ProviderStatus.ready);
  });
  test(
    'late provider after role refresh cannot repopulate homeowner',
    () async {
      var role = 'provider';
      final started = Completer<void>();
      final response = Completer<http.Response>();
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          if (r.url.path == '/api/provider/overview') {
            started.complete();
            return response.future;
          }
          return providerRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      final initial = vm.initialize();
      await started.future;
      role = 'homeowner';
      await vm.refresh();
      response.complete(base.jsonResponse({'overview': overview()}));
      await initial;
      expect(vm.data!.context.role, 'homeowner');
      expect(vm.provider.overview, isNull);
      expect(vm.canViewProvider, isFalse);
      expect(vm.canViewAccount, isTrue);
    },
  );
}
