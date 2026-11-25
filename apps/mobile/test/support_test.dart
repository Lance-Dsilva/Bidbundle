// Independent synthetic support fixtures; not live visibility/auth evidence.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/support/models.dart';
import 'package:bundleen/features/support/support_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;
import 'provider_test.dart' as provider;

Map<String, Object?> summary({String id = 't1'}) => {
  'id': id,
  'ticketNumber': 'BDL-42',
  'subject': 'Community gate assistance',
  'category': 'community',
  'status': 'pending_customer',
  'communityName': null,
  'createdAt': '2026-01-02T12:00:00.000Z',
  'lastActivityAt': '2026-11-01T15:00:00.000Z',
  'priority': 'urgent',
  'requesterName': 'Other resident',
  'requesterEmail': 'private@example.test',
  'requesterRole': 'homeowner',
  'communityId': 'c1',
  'assignedAdminUserId': 'admin-secret',
  'assignedAdminName': 'Private staff',
  'messageCount': 99,
  'awaitingAdminReply': false,
  'firstResponseOverdue': false,
  'ageHours': 100,
  'updatedAt': '2026-11-01T15:00:00.000Z',
};
Map<String, Object?> message({
  String id = 'm1',
  String kind = 'customer_reply',
  String side = 'customer',
}) => {
  'id': id,
  'kind': kind,
  'body': '<b>Plain message</b>\nhttps://untrusted.example/path',
  'authorName': 'Other resident',
  'authorSide': side,
  'fromAi': false,
  'createdAt': '2026-11-01T15:00:00.000Z',
};
Map<String, Object?> detail({String id = 't1'}) => {
  ...summary(id: id),
  'messages': [
    message(),
    message(id: 'm2', kind: 'admin_reply', side: 'support'),
  ],
  'relatedRequestId': 'hidden-request',
  'relatedBidId': null,
  'relatedVisitId': null,
  'reopenedFromTicketId': null,
  'canReply': true,
  'canReopen': true,
};
http.Response supportRoute(http.Request r, {String role = 'homeowner'}) {
  if (r.url.path == '/api/support/tickets') {
    return base.jsonResponse({
      'tickets': [summary()],
    });
  }
  if (r.url.path.startsWith('/api/support/tickets/')) {
    return base.jsonResponse({'ticket': detail(id: r.url.pathSegments.last)});
  }
  return provider.providerRoute(r, role: role);
}

SupportRepository repository(base.FakeAuth auth, http.Client client) =>
    SupportRepository(ApiClient(base.config(), auth, client));
void main() {
  test('summary retains rendered subset and nullable community', () {
    final v = SupportTicketSummary.fromJson(summary());
    expect(v.communityName, isNull);
    expect(v.ticketNumber, 'BDL-42');
    expect(v.createdAt.year, 2026);
  });
  for (final key in [
    'id',
    'ticketNumber',
    'subject',
    'category',
    'status',
    'communityName',
    'createdAt',
    'lastActivityAt',
  ]) {
    test('summary missing $key fails', () {
      final data = summary()..remove(key);
      expect(
        () => SupportTicketSummary.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final kind in ['internal_note', 'unknown']) {
    test('rejects privileged or unknown message $kind', () {
      expect(
        () => SupportMessage.fromJson(message(kind: kind)),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('rejects AI metadata and unknown author side', () {
    expect(
      () => SupportMessage.fromJson({...message(), 'fromAi': true}),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => SupportMessage.fromJson(message(side: 'admin')),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('detail keeps plain multiline body and visible messages only', () {
    final v = SupportTicketDetail.fromJson(detail());
    expect(v.messages, hasLength(2));
    expect(v.messages.first.body, contains('<b>'));
    expect(v.messages.first.body, contains('\n'));
  });
  test('100 list rows retained and exact GET routes encode ID', () async {
    final calls = <http.Request>[];
    final id = 't/ ?#';
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        calls.add(r);
        return r.url.path == '/api/support/tickets'
            ? base.jsonResponse({
                'tickets': List.generate(100, (i) => summary(id: 't$i')),
              })
            : base.jsonResponse({'ticket': detail(id: id)});
      }),
    );
    expect(await repo.loadList(), hasLength(100));
    expect((await repo.loadDetail(id)).id, id);
    expect(calls.map((r) => r.method), everyElement('GET'));
    expect(calls.first.url.query, isEmpty);
    expect(calls.last.url.pathSegments.last, id);
    expect(calls.last.url.toString(), contains('t%2F%20%3F%23'));
  });
  test('detail response ID mismatch rejected', () async {
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => base.jsonResponse({'ticket': detail(id: 'other')}),
      ),
    );
    await expectLater(
      repo.loadDetail('t1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final status in [403, 404, 409, 500]) {
    test(
      'detail$status never substitutes list and retry reauthorizes',
      () async {
        var failed = true;
        final vm = SupportModel(
          repository(
            base.FakeAuth()..active = true,
            MockClient(
              (r) async => r.url.path.endsWith('/t1') && failed
                  ? http.Response('', status)
                  : supportRoute(r),
            ),
          ),
          onSessionExpired: () {},
        );
        addTearDown(vm.dispose);
        vm.setOwner('u1');
        await vm.loadList();
        expect(vm.items, hasLength(1));
        await vm.openDetail('t1');
        expect(vm.detail, isNull);
        expect(vm.detailStatus, SupportStatus.failed);
        failed = false;
        await vm.refreshDetail();
        expect(vm.detail?.id, 't1');
      },
    );
  }
  test('oversized legitimate thread fails without truncation', () async {
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => base.jsonResponse({
          'ticket': {
            ...detail(),
            'messages': [
              {...message(), 'body': 'x' * (1024 * 1024)},
            ],
          },
        }),
      ),
    );
    await expectLater(
      repo.loadDetail('t1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('list loading empty failure retry are distinct', () async {
    final response = Completer<http.Response>();
    var retry = false;
    final vm = SupportModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async =>
              retry ? base.jsonResponse({'tickets': []}) : response.future,
        ),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final load = vm.loadList();
    expect(vm.listStatus, SupportStatus.loading);
    response.complete(http.Response('', 500));
    await load;
    expect(vm.listStatus, SupportStatus.failed);
    retry = true;
    await vm.loadList();
    expect(vm.listStatus, SupportStatus.ready);
    expect(vm.items, isEmpty);
  });
  for (final action in ['clear', 'owner', 'close']) {
    test('late detail after $action ignored', () async {
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final vm = SupportModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) async {
            if (r.url.path.endsWith('/t1')) {
              started.complete();
              return response.future;
            }
            return supportRoute(r);
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      await vm.loadList();
      final pending = vm.openDetail('t1');
      await started.future;
      if (action == 'clear') {
        vm.clear();
      } else if (action == 'owner') {
        vm.setOwner('u2');
      } else {
        vm.closeDetail();
      }
      response.complete(base.jsonResponse({'ticket': detail()}));
      await pending;
      expect(vm.detail, isNull);
      expect(vm.selectedId, isNull);
    });
  }
  for (final role in [
    'homeowner',
    'provider',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role support public navigation gate', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return supportRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      expect(
        vm.canViewSupport,
        ['homeowner', 'provider', 'hoa_staff'].contains(role),
      );
      expect(calls.where((p) => p.startsWith('/api/support/')), isEmpty);
    });
  }
  test('401forced renewal clears global support and Account', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/support/tickets'
            ? http.Response('', 401)
            : supportRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openSupport();
    expect(vm.signedIn, isFalse);
    expect(vm.support.items, isEmpty);
    expect(vm.support.detail, isNull);
    expect(vm.account.profile, isNull);
  });
  testWidgets(
    '200percent native back and notification switching clear support detail',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async => supportRoute(r)),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.runAsync(() => vm.account.openSupport());
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('View conversation'), 400);
      await tester.pumpAndSettle();
      await fixtures.tapAndLoad(tester, find.text('View conversation'));
      await tester.pumpAndSettle();
      expect(vm.support.detail, isNotNull);
      expect(
        tester.getTopLeft(find.text('Support conversation')).dy,
        lessThan(120),
      );
      await tester.scrollUntilVisible(find.text('Bundleen Support'), 400);
      await tester.pumpAndSettle();
      expect(find.text('Bundleen Support'), findsOneWidget);
      expect(find.text('private@example.test'), findsNothing);
      expect(find.text('Private staff'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.support.selectedId, isNull);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.runAsync(() => vm.account.openNotifications());
      await tester.pumpAndSettle();
      expect(vm.account.showingNotifications, isTrue);
      expect(vm.account.showingSupport, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets('iOS detail edge swipe and logout clear routes', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async => supportRoute(r)),
    );
    await fixtures.render(tester, vm);
    await fixtures.tapAndLoad(tester, find.text('Account'));
    await tester.runAsync(() => vm.account.openSupport());
    await tester.pumpAndSettle();
    await tester.runAsync(() => vm.support.openDetail('t1'));
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(1, 300), const Offset(750, 0));
    await tester.pumpAndSettle();
    expect(vm.support.selectedId, isNull);
    await tester.runAsync(() => vm.support.openDetail('t1'));
    await tester.pumpAndSettle();
    await tester.runAsync(() => vm.signOut());
    await tester.pumpAndSettle();
    expect(vm.support.detail, isNull);
    expect(find.text('Sign in'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
  test('empty visible conversation is valid despite unfiltered count', () {
    final v = SupportTicketDetail.fromJson({...detail(), 'messages': []});
    expect(v.messages, isEmpty);
  });
  for (final status in [
    'new',
    'open',
    'pending_customer',
    'pending_internal',
    'resolved',
    'closed',
  ]) {
    test('accepts inert status $status', () {
      expect(
        SupportTicketSummary.fromJson({...summary(), 'status': status}).status,
        status,
      );
    });
  }
  test('late list after account owner switch discarded', () async {
    final response = Completer<http.Response>();
    final vm = SupportModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => response.future),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final pending = vm.loadList();
    vm.setOwner('u2');
    response.complete(
      base.jsonResponse({
        'tickets': [summary()],
      }),
    );
    await pending;
    expect(vm.items, isEmpty);
  });

  test(
    'switching Support and notifications removes stale conversation',
    () async {
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async => supportRoute(r)),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      await vm.account.openSupport();
      await vm.support.openDetail('t1');
      expect(vm.support.detail, isNotNull);
      await vm.account.openNotifications();
      expect(vm.account.showingSupport, isFalse);
      expect(vm.support.selectedId, isNull);
      expect(vm.support.detail, isNull);
      await vm.account.openSupport();
      expect(vm.account.showingNotifications, isFalse);
    },
  );
  testWidgets(
    'rapid same ticket reopen and support notification route switch survive old removals',
    (tester) async {
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async => supportRoute(r)),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.runAsync(() => vm.account.openSupport());
      await tester.pumpAndSettle();
      await tester.runAsync(() => vm.support.openDetail('t1'));
      await tester.pumpAndSettle();
      vm.support.closeDetail();
      await tester.pump();
      await tester.runAsync(() => vm.support.openDetail('t1'));
      await tester.pumpAndSettle();
      expect(vm.support.selectedId, 't1');
      expect(find.text('Support conversation'), findsOneWidget);
      await tester.runAsync(() => vm.account.openNotifications());
      await tester.pump();
      await tester.runAsync(() => vm.account.openSupport());
      await tester.pumpAndSettle();
      expect(vm.account.showingSupport, isTrue);
      expect(vm.account.showingNotifications, isFalse);
      expect(find.text('Support requests'), findsWidgets);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );

  test('late old owner401 cannot expire newly scoped account', () async {
    final response = Completer<http.Response>();
    var expired = 0;
    final vm = SupportModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => response.future),
      ),
      onSessionExpired: () => expired++,
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final load = vm.loadList();
    vm.setOwner('u2');
    response.complete(http.Response('', 401));
    await load;
    expect(expired, 0);
    expect(vm.items, isEmpty);
  });
}
