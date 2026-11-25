// Synthetic participant-bound inbox fixtures, not live privacy proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/inbox/models.dart';
import 'package:bundleen/features/inbox/inbox_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;
import 'support_test.dart' as support;

Map<String, Object?> thread({String id = 't1'}) => {
  'id': id,
  'requestId': 'PRIVATE REQUEST',
  'requestTitle': 'Garden work',
  'communityName': 'Garden community',
  'otherPartyName': 'Alex Provider',
  'otherPartyRole': 'provider',
  'lastMessagePreview': null,
  'lastMessageAt': null,
  'unreadCount': 99,
};
Map<String, Object?> message({
  String id = 'm1',
  String conversation = 't1',
  bool mine = false,
}) => {
  'id': id,
  'conversationId': conversation,
  'senderUserId': 'PRIVATE SENDER',
  'senderName': 'Alex Provider',
  'isMine': mine,
  'body': '<b>Garden update</b>\nhttps://untrusted.example/path',
  'readAt': '2026-11-01T16:00:00.000Z',
  'createdAt': '2026-11-01T15:00:00.000Z',
};
Map<String, Object?> transcript({String id = 't1'}) => {
  'thread': thread(id: id),
  'messages': [
    message(conversation: id),
    message(id: 'm2', conversation: id, mine: true),
  ],
  'hasMore': true,
  'totalMessages': 100,
};
http.Response inboxRoute(http.Request r, {String role = 'homeowner'}) {
  if (r.url.path == '/api/homeowner/inbox' ||
      r.url.path == '/api/provider/inbox') {
    return base.jsonResponse({
      'threads': [thread()],
      'unreadTotal': 999,
    });
  }
  if (r.url.path.contains('/inbox/')) {
    return base.jsonResponse(transcript(id: r.url.pathSegments.last));
  }
  return support.supportRoute(r, role: role);
}

InboxRepository repository(base.FakeAuth auth, http.Client client) =>
    InboxRepository(ApiClient(base.config(), auth, client));
void main() {
  test('null previewdate and plain labels preserved', () {
    final v = InboxThread.fromJson(thread());
    expect(v.lastMessagePreview, isNull);
    expect(v.lastMessageAt, isNull);
    expect(v.otherPartyRole, 'provider');
  });
  for (final key in [
    'id',
    'requestTitle',
    'communityName',
    'otherPartyName',
    'otherPartyRole',
    'lastMessagePreview',
    'lastMessageAt',
  ]) {
    test('required thread$key missing rejected', () {
      final data = thread()..remove(key);
      expect(
        () => InboxThread.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('party enum and canonical date strict', () {
    expect(
      () => InboxThread.fromJson({...thread(), 'otherPartyRole': 'admin'}),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => InboxThread.fromJson({
        ...thread(),
        'lastMessageAt': '2026-02-31T15:00:00.000Z',
      }),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final key in [
    'id',
    'conversationId',
    'senderName',
    'isMine',
    'body',
    'createdAt',
  ]) {
    test('required message$key missing rejected', () {
      final data = message()..remove(key);
      expect(
        () => InboxMessage.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('thread and everymessage must match requestedconversation', () {
    expect(
      () => Conversation.fromJson(transcript(id: 'foreign'), 't1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => Conversation.fromJson({
        ...transcript(),
        'messages': [message(conversation: 'foreign')],
      }, 't1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('unique50messages and emptywindow independentoftotal', () {
    expect(
      () => Conversation.fromJson({
        ...transcript(),
        'messages': [message(), message()],
      }, 't1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => Conversation.fromJson({
        ...transcript(),
        'messages': List.generate(51, (i) => message(id: 'm$i')),
      }, 't1'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      Conversation.fromJson({
        ...transcript(),
        'messages': [],
        'totalMessages': 123,
      }, 't1').messages,
      isEmpty,
    );
  });
  for (final role in ['homeowner', 'hoa_staff', 'provider']) {
    test(
      '$role exact endpointGET and encodedID without readmutation',
      () async {
        final calls = <http.Request>[];
        final repo = repository(
          base.FakeAuth()..active = true,
          MockClient((r) async {
            calls.add(r);
            return inboxRoute(r, role: role);
          }),
        );
        await repo.loadList(role);
        final id = 't/ ?#';
        await repo.loadDetail(role, id);
        final prefix = role == 'provider' ? 'provider' : 'homeowner';
        expect(calls.first.url.path, '/api/$prefix/inbox');
        expect(calls.last.url.pathSegments.last, id);
        expect(calls.last.url.queryParameters, {'limit': '50', 'offset': '0'});
        expect(calls.map((r) => r.method), everyElement('GET'));
        expect(
          calls.any(
            (r) =>
                r.url.path.endsWith('/read') ||
                r.url.path.endsWith('/messages'),
          ),
          isFalse,
        );
      },
    );
  }
  for (final role in ['admin', 'unknown', '../provider']) {
    test('untrustedrole$role noendpointcall', () async {
      var calls = 0;
      final repo = repository(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls++;
          return inboxRoute(r);
        }),
      );
      await expectLater(repo.loadList(role), throwsA(isA<ApiFailure>()));
      expect(calls, 0);
    });
  }
  test('list100 retained and excessduplicates rejected', () async {
    var rows = List.generate(100, (i) => thread(id: 't$i'));
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async => base.jsonResponse({'threads': rows})),
    );
    expect(await repo.loadList('homeowner'), hasLength(100));
    rows = [thread(), thread()];
    await expectLater(
      repo.loadList('homeowner'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    rows = List.generate(101, (i) => thread(id: 't$i'));
    await expectLater(
      repo.loadList('homeowner'),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final code in [403, 404, 409, 500]) {
    test('detail$code no cachedlist fallback and retry', () async {
      var failed = true;
      final vm = InboxModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient(
            (r) async => r.url.path.endsWith('/t1') && failed
                ? http.Response('', code)
                : inboxRoute(r),
          ),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1', 'homeowner');
      await vm.loadList();
      await vm.openDetail('t1');
      expect(vm.detail, isNull);
      expect(vm.detailStatus, InboxStatus.failed);
      failed = false;
      await vm.refreshDetail();
      expect(vm.detail, isNotNull);
    });
  }
  test('only listedIDs get transcript and refresh clearsoldtext', () async {
    var refresh = false;
    final response = Completer<http.Response>();
    final calls = <String>[];
    final vm = InboxModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          if (refresh && r.url.path.endsWith('/t1')) return response.future;
          return inboxRoute(r);
        }),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1', 'homeowner');
    await vm.loadList();
    await vm.openDetail('unknown');
    expect(calls, hasLength(1));
    await vm.openDetail('t1');
    refresh = true;
    final pending = vm.refreshDetail();
    expect(vm.detail, isNull);
    response.complete(base.jsonResponse({...transcript(), 'messages': []}));
    await pending;
    expect(vm.detail!.messages, isEmpty);
  });
  for (final action in ['close', 'owner', 'role', 'clear']) {
    test('late detail after$action discarded', () async {
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final vm = InboxModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) async {
            if (r.url.path.endsWith('/t1')) {
              started.complete();
              return response.future;
            }
            return inboxRoute(r);
          }),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1', 'homeowner');
      await vm.loadList();
      final pending = vm.openDetail('t1');
      await started.future;
      if (action == 'close') {
        vm.close();
      } else if (action == 'owner') {
        vm.setOwner('u2', 'homeowner');
      } else if (action == 'role') {
        vm.setOwner('u1', 'provider');
      } else {
        vm.clear();
      }
      response.complete(base.jsonResponse(transcript()));
      await pending;
      expect(vm.detail, isNull);
      expect(vm.selectedId, isNull);
    });
  }
  test('1MiB transcript failure preservesAccount', () async {
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => r.url.path.endsWith('/inbox/t1')
            ? base.jsonResponse({
                ...transcript(),
                'messages': [
                  {...message(), 'body': 'x' * (1024 * 1024)},
                ],
              })
            : inboxRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openInbox();
    await vm.inbox.openDetail('t1');
    expect(vm.inbox.detailStatus, InboxStatus.failed);
    expect(vm.account.profile, isNotNull);
  });
  test('401forcedrenewal clearsglobalInbox', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/homeowner/inbox'
            ? http.Response('', 401)
            : inboxRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openInbox();
    expect(vm.signedIn, isFalse);
    expect(vm.inbox.items, isEmpty);
    expect(vm.account.profile, isNull);
  });
  test('transcripttimeout remains error not empty', () async {
    final vm = InboxModel(
      InboxRepository(
        ApiClient(
          base.config(),
          base.FakeAuth()..active = true,
          MockClient(
            (r) async => r.url.path.endsWith('/t1')
                ? Completer<http.Response>().future
                : inboxRoute(r),
          ),
          timeout: const Duration(milliseconds: 10),
        ),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1', 'homeowner');
    await vm.loadList();
    await vm.openDetail('t1');
    expect(vm.detailStatus, InboxStatus.failed);
    expect(vm.detail, isNull);
  });
  testWidgets(
    '200percent Inbox actualnavigation plaintext no receipts and back',
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
          return inboxRoute(r);
        }),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.scrollUntilVisible(find.text('Inbox'), 400);
      await tester.pumpAndSettle();
      await fixtures.tapAndLoad(tester, find.text('Inbox'));
      await tester.scrollUntilVisible(find.text('View conversation'), 400);
      await tester.pumpAndSettle();
      await fixtures.tapAndLoad(tester, find.text('View conversation'));
      expect(tester.getTopLeft(find.text('Conversation')).dy, lessThan(120));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('You'), 400);
      await tester.pumpAndSettle();
      expect(find.textContaining('PRIVATE'), findsNothing);
      expect(find.text('999'), findsNothing);
      expect(tester.takeException(), isNull);
      expect(calls.map((r) => r.method), everyElement('GET'));
      expect(
        calls.any(
          (r) =>
              r.url.path.endsWith('/read') || r.url.path.endsWith('/messages'),
        ),
        isFalse,
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.inbox.selectedId, isNull);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.account.showingInbox, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets('iOS Inbox edgeback rapidreopen siblingroute and signout', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async => inboxRoute(r)),
    );
    await fixtures.render(tester, vm);
    await fixtures.tapAndLoad(tester, find.text('Account'));
    await tester.runAsync(() => vm.account.openInbox());
    await tester.pumpAndSettle();
    await tester.runAsync(() => vm.inbox.openDetail('t1'));
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(1, 300), const Offset(750, 0));
    await tester.pumpAndSettle();
    expect(vm.inbox.selectedId, isNull);
    await tester.runAsync(() => vm.inbox.openDetail('t1'));
    await tester.pumpAndSettle();
    vm.inbox.closeDetail();
    await tester.pump();
    await tester.runAsync(() => vm.inbox.openDetail('t1'));
    await tester.pumpAndSettle();
    expect(vm.inbox.selectedId, 't1');
    await tester.runAsync(() => vm.account.openNotifications());
    await tester.pump();
    await tester.runAsync(() => vm.account.openInbox());
    await tester.pumpAndSettle();
    expect(vm.account.showingInbox, isTrue);
    expect(vm.account.showingNotifications, isFalse);
    await tester.runAsync(() => vm.signOut());
    await tester.pumpAndSettle();
    expect(vm.inbox.detail, isNull);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
  for (final role in [
    'homeowner',
    'hoa_staff',
    'provider',
    'admin',
    'unknown',
  ]) {
    test('$role lazyAccountInbox path gate', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return inboxRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      expect(calls.where((p) => p.endsWith('/inbox')), isEmpty);
      await vm.account.openInbox();
      final selected = calls.where((p) => p.endsWith('/inbox')).toList();
      expect(selected.length, ['admin', 'unknown'].contains(role) ? 0 : 1);
      if (selected.isNotEmpty) {
        expect(
          selected.single,
          role == 'provider' ? '/api/provider/inbox' : '/api/homeowner/inbox',
        );
      }
    });
  }
  test('oldowner401 cannot expire newInboxscope', () async {
    final response = Completer<http.Response>();
    var expired = 0;
    final vm = InboxModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => response.future),
      ),
      onSessionExpired: () => expired++,
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1', 'homeowner');
    final pending = vm.loadList();
    vm.setOwner('u2', 'provider');
    response.complete(http.Response('', 401));
    await pending;
    expect(expired, 0);
    expect(vm.items, isEmpty);
  });
  test('everyAccount sibling clears prior Inbox transcript', () async {
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async => inboxRoute(r, role: 'provider')),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    for (final navigate in [
      vm.account.openNotifications,
      vm.account.openSupport,
      vm.account.openServiceAreas,
      vm.account.openReviews,
    ]) {
      await vm.account.openInbox();
      await vm.inbox.openDetail('t1');
      expect(vm.inbox.detail, isNotNull);
      await navigate();
      expect(vm.account.showingInbox, isFalse);
      expect(vm.inbox.detail, isNull);
      expect(vm.inbox.selectedId, isNull);
    }
  });
}
