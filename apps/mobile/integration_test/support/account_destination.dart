import 'package:bundleen/features/account/account_screen.dart';
import 'package:bundleen/features/home/home_model.dart';
import 'package:bundleen/features/inbox/inbox_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Destination proof independent of lazy, scroll-position-dependent text.
void expectCurrentAccountDestination(WidgetTester tester, HomeModel model) {
  expect(model.showAccount, isTrue);
  expect(model.account.showingInbox, isFalse);
  expect(model.inbox.selectedId, isNull);
  expect(model.inbox.detail, isNull);
  expect(model.inbox.items, isEmpty);
  final account = find.byType(AccountScreen);
  expect(account, findsOneWidget);
  expect(account.hitTestable(), findsOneWidget);
  final element = tester.element(account);
  final route = ModalRoute.of(element);
  expect(route, isNotNull);
  expect(route!.isCurrent, isTrue);
  expect(route.settings, isA<Page<void>>());
  expect((route.settings as Page<void>).key, const ValueKey('account'));
  expect(
    Navigator.of(element).widget.pages.last.key,
    const ValueKey('account'),
  );
  final render = tester.renderObject<RenderBox>(account);
  expect(render.attached, isTrue);
  expect(render.hasSize, isTrue);
  expect(render.size.isEmpty, isFalse);
  final viewport =
      Offset.zero & (tester.view.physicalSize / tester.view.devicePixelRatio);
  expect(tester.getRect(account).overlaps(viewport), isTrue);
  expect(find.byType(InboxScreen), findsNothing);
  expect(find.text('Conversation'), findsNothing);
}
