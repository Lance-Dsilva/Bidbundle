// WidgetTester regression only; this is not native input evidence.
import 'package:bundleen/features/account/account_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';

import '../integration_test/support/account_destination.dart';
import 'inbox_test.dart' as inbox;
import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;

void main() {
  for (final scale in [1.0, 2.0]) {
    testWidgets('Account destination survives retained scroll at ${scale}x', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(() {
        debugDefaultTargetPlatformOverride = null;
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
        tester.platformDispatcher.clearTextScaleFactorTestValue();
      });
      final client = MockClient((r) async => inbox.inboxRoute(r));
      final model = base.model(base.FakeAuth()..active = true, client);
      try {
        await fixtures.render(tester, model);
        await fixtures.tapAndLoad(tester, find.text('Account').last);
        final accountScroll = find
            .descendant(
              of: find.byType(AccountScreen),
              matching: find.byType(Scrollable),
            )
            .first;
        await tester.scrollUntilVisible(
          find.text('Inbox'),
          180,
          scrollable: accountScroll,
        );
        await tester.ensureVisible(find.text('Inbox'));
        await tester.pumpAndSettle();
        final scroll = tester.state<ScrollableState>(accountScroll);
        final offset = scroll.position.pixels;
        expect(offset, greaterThan(0));
        const copy =
            'Your account details. Editing is not available in this preview.';
        expect(find.text(copy), findsNothing);
        await fixtures.tapAndLoad(tester, find.text('Inbox'));
        expect(model.account.showingInbox, isTrue);
        await tester.dragFrom(const Offset(1, 400), const Offset(360, 0));
        await tester.pumpAndSettle();
        expect(find.text(copy), findsNothing);
        expect(scroll.position.pixels, offset);
        expectCurrentAccountDestination(tester, model);
      } finally {
        try {
          await tester.pumpWidget(const SizedBox.shrink());
        } finally {
          try {
            model.dispose();
          } finally {
            client.close();
            debugDefaultTargetPlatformOverride = null;
          }
        }
      }
    });
  }
}
