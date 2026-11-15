import 'package:bundleen/features/home/home_model.dart';
import 'package:bundleen/features/inbox/inbox_screen.dart';
import 'package:bundleen/features/requests/requests_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void _visibleCurrentPage(
  WidgetTester tester,
  Finder screen,
  String key,
  List<String> pages,
) {
  expect(screen, findsOneWidget);
  expect(screen.hitTestable(), findsOneWidget);
  final element = tester.element(screen);
  final route = ModalRoute.of(element);
  expect(route, isNotNull);
  expect(route!.isCurrent, isTrue);
  expect(route.settings, isA<Page<void>>());
  expect((route.settings as Page<void>).key, ValueKey(key));
  expect(
    Navigator.of(element).widget.pages.map((p) => p.key),
    pages.map((p) => ValueKey(p)).toList(),
  );
  expect(Navigator.of(element).widget.pages.last.key, ValueKey(key));
  final render = tester.renderObject<RenderBox>(screen);
  expect(render.attached, isTrue);
  expect(render.hasSize, isTrue);
  expect(render.size.isEmpty, isFalse);
  final viewport =
      Offset.zero & (tester.view.physicalSize / tester.view.devicePixelRatio);
  expect(tester.getRect(screen).overlaps(viewport), isTrue);
}

/// Synthetic fixture expectations, independent of lazy headings/scroll position.
void expectRequestsListDestination(WidgetTester tester, HomeModel model) {
  expect(model.showRequests, isTrue);
  expect(model.requests.selectedId, isNull);
  expect(model.requests.detail, isNull);
  expect(model.requests.items.map((i) => i.id), ['r1']);
  expect(model.requests.items.single.title, 'Garden care');
  final screen = find.byWidgetPredicate(
    (w) => w is RequestsScreen && !w.detailView,
  );
  _visibleCurrentPage(tester, screen, 'requests-list', ['requests-list']);
  expect(tester.widget<RequestsScreen>(screen).model, same(model.requests));
  expect(
    find.byWidgetPredicate(
      (w) => w is RequestsScreen && w.detailView,
      skipOffstage: false,
    ),
    findsNothing,
  );
}

void expectInboxListDestination(WidgetTester tester, HomeModel model) {
  expect(model.showAccount, isTrue);
  expect(model.account.showingInbox, isTrue);
  expect(model.inbox.selectedId, isNull);
  expect(model.inbox.detail, isNull);
  expect(model.inbox.items.map((i) => i.id), ['t1']);
  expect(model.inbox.items.single.requestTitle, 'Garden work');
  final screen = find.byWidgetPredicate(
    (w) => w is InboxScreen && !w.detailView,
  );
  _visibleCurrentPage(tester, screen, 'inbox-list', ['account', 'inbox-list']);
  expect(tester.widget<InboxScreen>(screen).model, same(model.inbox));
  expect(
    find.byWidgetPredicate(
      (w) => w is InboxScreen && w.detailView,
      skipOffstage: false,
    ),
    findsNothing,
  );
}
