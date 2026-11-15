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
    testWidgets('synthetic presentation ${scale}x', (tester) async {
      final fixture = FixtureHarness('provider')..install();
      final model = base.model(fixture.auth, fixture.client);
      final semantics = tester.ensureSemantics();
      try {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        await tester.pumpWidget(app.BundleenApp(model: model));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Account').last);
        await tester.pumpAndSettle();
        final serviceAreas = find.text('Service areas');
        await tester.scrollUntilVisible(
          serviceAreas,
          180,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.pumpAndSettle();
        fixture.failOnce.add('/api/provider/service-areas');
        await tester.tap(serviceAreas);
        await tester.pumpAndSettle();
        // No scroll/ensureVisible after entering this route: Retry must start on screen.
        final retry = find.text('Retry');
        expect(retry.hitTestable(), findsOneWidget);
        expect(find.byType(BackButton).hitTestable(), findsOneWidget);
        expect(find.text('Sign out').hitTestable(), findsOneWidget);
        final header = find.byType(AppBar);
        final mark = find.descendant(of: header, matching: find.byType(Image));
        expect(mark, findsOneWidget);
        final markRect = tester.getRect(mark);
        final backRect = tester.getRect(find.byType(BackButton));
        final signoutRect = tester.getRect(find.text('Sign out'));
        expect(markRect.overlaps(backRect), isFalse);
        expect(markRect.overlaps(signoutRect), isFalse);
        final titleWidget = tester.widget<AppBar>(header).title!;
        final titleRect = tester.getRect(find.byWidget(titleWidget));
        expect(titleRect.overlaps(backRect), isFalse);
        expect(titleRect.overlaps(signoutRect), isFalse);
        expect(
          MediaQuery.textScalerOf(tester.element(find.byType(Scaffold)))
              .scale(16),
          16 * scale,
        );
        expect(tester.takeException(), isNull);
        if (Platform.isAndroid) {
          await binding.convertFlutterSurfaceToImage();
          await tester.pumpAndSettle();
        }
        await binding.takeScreenshot(
          'synthetic-presentation-${scale.toInt()}x-error',
        );
        await tester.tap(retry);
        await tester.pumpAndSettle();
        expect(find.text('Retry'), findsNothing);
        expect(find.text('<b>North service area</b>'), findsOneWidget);
        await binding.takeScreenshot(
          'synthetic-presentation-${scale.toInt()}x-ready',
        );
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Sign out'));
        await tester.pumpAndSettle();
        expect(find.text('Sign in'), findsOneWidget);
        expect(model.data, isNull);
        expect(model.signedIn, isFalse);
        expect(fixture.auth.active, isFalse);
        final expected = <String>[
          '/api/profile',
          '/api/profile',
          '/api/me/context',
          '/api/provider/overview',
          '/api/provider/service-areas',
          '/api/provider/service-areas',
        ]..sort();
        expect([...fixture.audit]..sort(), expected);
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
