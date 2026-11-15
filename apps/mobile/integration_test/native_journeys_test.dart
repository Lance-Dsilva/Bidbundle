import 'dart:io';
import 'dart:ui' show SemanticsAction;

import 'package:bundleen/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/mobile_test.dart' as base;
import 'support/fixture_harness.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('synthetic guard self-checks', (tester) async {
    final fixture = FixtureHarness('homeowner')..install();
    try {
      expect(() => HttpClient(), throwsStateError);
      await expectLater(
        fixture.client.get(
          Uri.parse('https://api.example.test/api/unexpected'),
        ),
        throwsStateError,
      );
      await expectLater(
        const MethodChannel('bundleen/auth').invokeMethod<void>('initialize'),
        throwsA(isA<PlatformException>()),
      );
      expect(fixture.violations, [
        'real HttpClient',
        'unexpected service request',
        'native auth channel',
      ]);
    } finally {
      fixture.dispose();
    }
  });
  for (final role in ['homeowner', 'provider']) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('synthetic $role journey text $scale', (tester) async {
        final fixture = FixtureHarness(role)..install();
        final model = base.model(fixture.auth, fixture.client);
        final semantics = tester.ensureSemantics();
        void checkControl(Finder finder, String label) {
          final node = tester.getSemantics(finder);
          final data = node.getSemanticsData();
          expect(data.label, contains(label));
          expect(data.hasAction(SemanticsAction.tap), isTrue);
          expect(data.flagsCollection.isButton, isTrue);
          expect(node.rect.height, greaterThanOrEqualTo(48));
          expect(node.rect.width, greaterThanOrEqualTo(48));
        }

        Future<void> tap(String text) async {
          final rawFinder = find.text(text);
          if (rawFinder.evaluate().isEmpty) {
            await tester.scrollUntilVisible(
              rawFinder,
              220,
              scrollable: find.byType(Scrollable).last,
              maxScrolls: 35,
            );
          }
          await tester.pumpAndSettle();
          final finder = rawFinder.last;
          await tester.ensureVisible(finder);
          await tester.pumpAndSettle();
          expect(
            finder.hitTestable(),
            findsOneWidget,
            reason: '$text must be visibly tappable',
          );
          if ({'Account', 'Retry', 'Sign out'}.contains(text)) {
            checkControl(finder, text);
          }
          await tester.tap(finder);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }

        Future<void> back() async {
          await tester.tap(find.byType(BackButton));
          await tester.pumpAndSettle();
        }

        var surfaceConverted = false;
        Future<void> capture(String name) async {
          if (Platform.isAndroid && !surfaceConverted) {
            await binding.convertFlutterSurfaceToImage();
            surfaceConverted = true;
            await tester.pumpAndSettle();
          }
          await binding.takeScreenshot(
            'synthetic-$role-${scale.toInt()}x-$name',
          );
        }

        try {
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          await tester.pumpWidget(app.BundleenApp(model: model));
          await tester.pumpAndSettle();
          expect(find.byType(NavigationBar), findsOneWidget);
          checkControl(find.text('Account').last, 'Account');
          final screenContext = tester.element(find.byType(Scaffold).first);
          expect(
            MediaQuery.textScalerOf(screenContext).scale(16),
            closeTo(16 * scale, 0.001),
          );
          if (role == 'homeowner') {
            fixture.failOnce.add('/api/homeowner/requests');
            await tap('Requests');
            expect(find.text('Retry'), findsOneWidget);
            await capture('error');
            await tap('Retry');
            await tap('View details');
            expect(find.text('Request details'), findsOneWidget);
            await capture('request');
            await back();
            await tap('Community');
            expect(find.text('Garden neighborhood'), findsOneWidget);
            await tap('Account');
            await tap('Inbox');
            await tap('View conversation');
            expect(find.text('Conversation'), findsOneWidget);
            await capture('conversation');
            await back();
            await back();
          } else {
            await tap('Opportunities');
            await tap('Show details');
            expect(find.text('Hide details'), findsOneWidget);
            await capture('opportunities');
            await tap('Account');
            fixture.failOnce.add('/api/provider/service-areas');
            await tap('Service areas');
            expect(find.text('Retry'), findsOneWidget);
            await capture('error');
            await tap('Retry');
            expect(find.text('<b>North service area</b>'), findsOneWidget);
            await back();
          }
          await tap('Sign out');
          expect(find.text('Sign in'), findsOneWidget);
          expect(model.data, isNull);
          expect(fixture.auth.active, isFalse);
          // Home profile/context may resolve concurrently: exact multiset, not scheduling order.
          final expected = <String>[
            '/api/profile',
            '/api/profile',
            '/api/me/context',
            if (role == 'homeowner') ...[
              '/api/homeowner/dashboard',
              '/api/homeowner/requests',
              '/api/homeowner/requests',
              '/api/homeowner/requests/r1',
              '/api/homeowner/neighbourhood',
              '/api/homeowner/inbox',
              '/api/homeowner/inbox/t1?limit=50&offset=0',
            ] else ...[
              '/api/provider/overview',
              '/api/provider/marketplace',
              '/api/provider/service-areas',
              '/api/provider/service-areas',
            ],
          ]..sort();
          expect([...fixture.audit]..sort(), expected);
          await capture('signed-out');
          expect(fixture.violations, isEmpty);
        } finally {
          try {
            await tester.pumpWidget(const SizedBox.shrink());
            await tester.pumpAndSettle();
          } finally {
            try {
              model.dispose();
            } finally {
              try {
                semantics.dispose();
              } finally {
                tester.platformDispatcher.clearTextScaleFactorTestValue();
                fixture.dispose();
              }
            }
          }
          expect(fixture.violations, isEmpty);
        }
      });
    }
  }
}
