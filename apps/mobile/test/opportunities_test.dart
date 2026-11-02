// Independent source-shaped fixtures, never live marketplace proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/opportunities/models.dart';
import 'package:bundleen/features/opportunities/opportunities_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'provider_test.dart' as provider;
import 'requests_test.dart' as fixtures;

Map<String, Object?> opportunity({String id = 'r1'}) => {
  'requestId': id,
  'communityName': 'Garden community',
  'title': 'Shared garden care',
  'category': 'landscaping',
  'description': '<b>Trim shared gardens</b>\nhttps://untrusted.example/path',
  'context': 'neighborhood',
  'kind': 'optional_group',
  'locality': null,
  'region': null,
  'recurrenceLabel': null,
  'totalOccurrences': 1,
  'homeCount': 8,
  'approximateDistanceMi': 2.5,
  'startDate': null,
  'biddingClosesAt': '2026-12-01T15:00:00.000Z',
  'budgetMinCents': 123456,
  'budgetMaxCents': 234567,
  'myBid': {'amountCents': 876543, 'currency': 'usd', 'scope': 'private bid'},
};
Map<String, Object?> workspace({
  bool eligible = true,
  List<Map<String, Object?>>? rows,
}) => {
  'eligible': eligible,
  'ineligibleReason': eligible
      ? null
      : 'Your provider account is pending review.',
  'feed': rows ?? (eligible ? [opportunity()] : []),
  'serviceAreas': [
    {'address': 'PRIVATE AREA'},
  ],
  'categories': ['landscaping'],
  'bids': [
    {'amountCents': 876543},
  ],
  'agreements': [
    {'scope': 'PRIVATE AGREEMENT'},
  ],
  'occurrencesByAgreement': {
    'a1': [
      {
        'visits': [
          {
            'addressLine1': 'PRIVATE ADDRESS',
            'accessNotes': 'SECRET GATE CODE',
          },
        ],
      },
    ],
  },
};
http.Response opportunityRoute(
  http.Request r, {
  String role = 'provider',
  Map<String, Object?>? data,
}) => r.url.path == '/api/provider/marketplace'
    ? base.jsonResponse({'workspace': data ?? workspace()})
    : provider.providerRoute(r, role: role);
OpportunitiesRepository repository(base.FakeAuth auth, http.Client client) =>
    OpportunitiesRepository(ApiClient(base.config(), auth, client));
void main() {
  test('null distance dates locality and recurrence remain absent', () {
    final v = Opportunity.fromJson({
      ...opportunity(),
      'approximateDistanceMi': null,
    });
    expect(v.approximateDistanceMi, isNull);
    expect(v.startDate, isNull);
    expect(v.locality, isNull);
    expect(v.recurrenceLabel, isNull);
    expect(v.description, contains('<b>'));
  });
  for (final key in [
    'requestId',
    'communityName',
    'title',
    'category',
    'description',
    'context',
    'kind',
    'locality',
    'region',
    'recurrenceLabel',
    'totalOccurrences',
    'homeCount',
    'approximateDistanceMi',
    'startDate',
    'biddingClosesAt',
  ]) {
    test('required opportunity$key missing fails', () {
      final data = opportunity()..remove(key);
      expect(
        () => Opportunity.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final entry in <String, List<Object?>>{
    'context': ['unknown'],
    'kind': ['unknown'],
    'totalOccurrences': [-1, 0.5, 9007199254740992],
    'homeCount': [-1, 0.5],
    'approximateDistanceMi': [-1, double.nan, double.infinity],
    'startDate': ['yesterday', '2026-02-31T15:00:00.000Z'],
  }.entries) {
    for (final invalid in entry.value) {
      test('invalid ${entry.key}=$invalid fails', () {
        expect(
          () => Opportunity.fromJson({...opportunity(), entry.key: invalid}),
          throwsA(base.failure(FailureKind.invalidResponse)),
        );
      });
    }
  }
  test(
    'eligible empty and ineligible distinguished; contradictory feed fails',
    () {
      final empty = OpportunitiesFeed.fromJson(workspace(rows: []));
      expect(empty.eligible, isTrue);
      expect(empty.items, isEmpty);
      final blocked = OpportunitiesFeed.fromJson(workspace(eligible: false));
      expect(blocked.eligible, isFalse);
      expect(blocked.ineligibleReason, contains('pending'));
      expect(
        () => OpportunitiesFeed.fromJson(
          workspace(eligible: false, rows: [opportunity()]),
        ),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    },
  );
  test(
    'repository GET envelope retains200rows with no directIDquery',
    () async {
      final calls = <http.Request>[];
      final repo = repository(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r);
          return opportunityRoute(
            r,
            data: workspace(
              rows: List.generate(200, (i) => opportunity(id: 'r$i')),
            ),
          );
        }),
      );
      final feed = await repo.load();
      expect(feed.items, hasLength(200));
      expect(calls.single.method, 'GET');
      expect(calls.single.url.path, '/api/provider/marketplace');
      expect(calls.single.url.query, isEmpty);
      expect(calls.single.body, isEmpty);
    },
  );
  for (final code in [403, 409, 500]) {
    test('marketplace$code preserves Account and retries', () async {
      var failed = true;
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/marketplace' && failed
              ? http.Response('', code)
              : opportunityRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openOpportunities();
      expect(vm.opportunities.status, OpportunitiesStatus.failed);
      expect(vm.canViewAccount, isTrue);
      await vm.openAccount();
      expect(vm.account.profile, isNotNull);
      failed = false;
      await vm.openOpportunities();
      await vm.opportunities.load();
      expect(vm.opportunities.status, OpportunitiesStatus.ready);
    });
  }
  for (final role in [
    'provider',
    'homeowner',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role marketplace isolation', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return opportunityRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openOpportunities();
      expect(
        calls.where((p) => p == '/api/provider/marketplace').length,
        role == 'provider' ? 1 : 0,
      );
      if (role == 'provider') {
        expect(calls.where((p) => p.startsWith('/api/homeowner/')), isEmpty);
      }
    });
  }
  test(
    'refresh immediately clears feed and expansion then replaces rows',
    () async {
      var refresh = false;
      final response = Completer<http.Response>();
      final vm = OpportunitiesModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient(
            (r) async => refresh ? response.future : opportunityRoute(r),
          ),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      await vm.load();
      vm.toggleExpanded('r1');
      expect(vm.expandedId, 'r1');
      refresh = true;
      final pending = vm.load();
      expect(vm.feed, isNull);
      expect(vm.expandedId, isNull);
      expect(vm.status, OpportunitiesStatus.loading);
      response.complete(base.jsonResponse({'workspace': workspace(rows: [])}));
      await pending;
      expect(vm.feed!.items, isEmpty);
    },
  );
  for (final action in ['clear', 'owner', 'close']) {
    test('late feed after$action discarded', () async {
      final response = Completer<http.Response>();
      final vm = OpportunitiesModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) => response.future),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      final pending = vm.load();
      if (action == 'clear') {
        vm.clear();
      } else if (action == 'owner') {
        vm.setOwner('u2');
      } else {
        vm.close();
      }
      response.complete(base.jsonResponse({'workspace': workspace()}));
      await pending;
      expect(vm.feed, isNull);
      expect(vm.expandedId, isNull);
    });
  }
  test(
    'oversized workspace fails before projection without losing Account',
    () async {
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/marketplace'
              ? base.jsonResponse({
                  'workspace': {
                    ...workspace(),
                    'privateLargeField': 'x' * (1024 * 1024),
                  },
                })
              : opportunityRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openOpportunities();
      expect(vm.opportunities.status, OpportunitiesStatus.failed);
      expect(vm.opportunities.feed, isNull);
      expect(vm.canViewAccount, isTrue);
    },
  );
  test('401forced renewal clears all session models', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/marketplace'
            ? http.Response('', 401)
            : opportunityRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openOpportunities();
    expect(vm.signedIn, isFalse);
    expect(vm.opportunities.feed, isNull);
    expect(vm.provider.overview, isNull);
    expect(vm.canViewAccount, isFalse);
  });
  testWidgets(
    '200percent expansion plain text private omission GETonly and back',
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
          return opportunityRoute(r);
        }),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Opportunities'));
      await tester.scrollUntilVisible(find.text('Show details'), 400);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show details'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('<b>Trim shared gardens</b>\nhttps://untrusted.example/path'),
        400,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('PRIVATE'), findsNothing);
      expect(find.textContaining('SECRET'), findsNothing);
      expect(find.textContaining('876543'), findsNothing);
      final count = calls.length;
      await tester.tap(
        find.text('<b>Trim shared gardens</b>\nhttps://untrusted.example/path'),
      );
      await tester.pumpAndSettle();
      expect(calls, hasLength(count));
      expect(calls.map((r) => r.method), everyElement('GET'));
      expect(calls.where((r) => r.url.path.contains('/marketplace/')), isEmpty);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.showOpportunities, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  test('over200 and duplicate request IDs fail rather than truncate', () {
    expect(
      () => OpportunitiesFeed.fromJson(
        workspace(rows: List.generate(201, (i) => opportunity(id: 'r$i'))),
      ),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => OpportunitiesFeed.fromJson(
        workspace(rows: [opportunity(), opportunity()]),
      ),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('late401 cannot expire new owner', () async {
    final response = Completer<http.Response>();
    var expired = 0;
    final vm = OpportunitiesModel(
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
    expect(vm.feed, isNull);
  });
  test(
    'global signout during marketplace read prevents late repopulation',
    () async {
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          if (r.url.path == '/api/provider/marketplace') {
            started.complete();
            return response.future;
          }
          return opportunityRoute(r);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      final pending = vm.openOpportunities();
      await started.future;
      await vm.signOut();
      response.complete(base.jsonResponse({'workspace': workspace()}));
      await pending;
      expect(vm.opportunities.feed, isNull);
      expect(vm.showOpportunities, isFalse);
      expect(vm.canViewAccount, isFalse);
    },
  );
}
