import 'dart:io';

import 'package:bundleen/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/mobile_test.dart' as base;
import 'support/fixture_harness.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  for (final scale in [1.0, 2.0]) {
    testWidgets('external native navigation homeowner ${scale}x', (
      tester,
    ) async {
      final fixture = FixtureHarness('homeowner')..install();
      final model = base.model(fixture.auth, fixture.client);
      final semantics = tester.ensureSemantics();
      Future<void> setupTap(String label) async {
        final raw = find.text(label);
        if (raw.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            raw,
            180,
            scrollable: find.byType(Scrollable).last,
          );
        }
        await tester.pumpAndSettle();
        await tester.ensureVisible(raw.last);
        await tester.pumpAndSettle();
        expect(raw.last.hitTestable(), findsOneWidget);
        await tester.tap(raw.last);
        await tester.pumpAndSettle();
      }

      Future<void> external(String step, bool Function() finished) async {
        debugPrint(
          'N04_READY homeowner ${scale.toInt()}x $step ${Platform.isAndroid ? 'ANDROID_KEYCODE_BACK' : 'IOS_EDGE_SWIPE'}',
        );
        final deadline = DateTime.now().add(const Duration(seconds: 90));
        while (!finished() && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(
          finished(),
          isTrue,
          reason: 'External input did not complete $step within 90 seconds',
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(fixture.violations, isEmpty);
        debugPrint('N04_OBSERVED homeowner ${scale.toInt()}x $step');
      }

      try {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        await tester.pumpWidget(app.BundleenApp(model: model));
        await tester.pumpAndSettle();
        expect(
          MediaQuery.textScalerOf(tester.element(find.byType(Scaffold)))
              .scale(16),
          16 * scale,
        );
        expect(
          tester.getSemantics(find.text('Account').last).label,
          contains('Account'),
        );
        await setupTap('Requests');
        await setupTap('View details');
        expect(find.text('Request details'), findsOneWidget);
        await external(
          'request-detail-back',
          () => model.requests.selectedId == null,
        );
        expect(model.showRequests, isTrue);
        await setupTap('Account');
        await setupTap('Inbox');
        await setupTap('View conversation');
        expect(find.text('Conversation'), findsOneWidget);
        await external(
          'inbox-detail-back',
          () => model.inbox.selectedId == null,
        );
        expect(model.account.showingInbox, isTrue);
        await external('inbox-list-back', () => !model.account.showingInbox);
        expect(model.showAccount, isTrue);
        if (Platform.isAndroid) {
          await external('account-top-back', () => !model.showAccount);
        } else {
          // A root tab has no iOS pop route: this is setup, not edge-swipe proof.
          await setupTap('Home');
        }
        expect(model.showAccount, isFalse);
        await setupTap('Account');
        await setupTap('Inbox');
        await setupTap('View conversation');
        await setupTap('Sign out');
        expect(model.data, isNull);
        expect(model.inbox.detail, isNull);
        expect(model.inbox.items, isEmpty);
        expect(fixture.auth.active, isFalse);
        expect(find.text('Sign in'), findsOneWidget);
        // Capture before Android system Back may normally background/exit the activity.
        if (Platform.isAndroid) {
          await binding.convertFlutterSurfaceToImage();
          await tester.pumpAndSettle();
        }
        await binding.takeScreenshot(
          'synthetic-navigation-${scale.toInt()}x-signed-out',
        );
        debugPrint(
          'N04_READY homeowner ${scale.toInt()}x signed-out-back ${Platform.isAndroid ? 'ANDROID_KEYCODE_BACK' : 'IOS_EDGE_SWIPE_NO_ROUTE'}',
        );
        final until = DateTime.now().add(const Duration(seconds: 30));
        while (DateTime.now().isBefore(until)) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(model.data, isNull);
        expect(model.signedIn, isFalse);
        expect(model.inbox.detail, isNull);
        expect(model.requests.detail, isNull);
        expect(model.account.profile, isNull);
        expect(fixture.violations, isEmpty);
        debugPrint(
          'N04_OBSERVED homeowner ${scale.toInt()}x private-state-still-cleared; external delivery requires reviewer evidence',
        );
      } finally {
        try {
          try {
            await tester.pumpWidget(const SizedBox.shrink());
          } finally {
            try {
              model.dispose();
            } finally {
              try {
                semantics.dispose();
              } finally {
                try {
                  tester.platformDispatcher.clearTextScaleFactorTestValue();
                } finally {
                  fixture.dispose();
                }
              }
            }
          }
        } finally {
          expect(fixture.violations, isEmpty);
        }
      }
    });
  }
}
