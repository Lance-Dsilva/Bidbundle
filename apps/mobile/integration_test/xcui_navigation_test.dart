import 'dart:developer' as developer;
import 'dart:io';
import 'dart:isolate';

import 'package:bundleen/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/mobile_test.dart' as base;
import 'support/fixture_harness.dart';

// Only this test entry point exposes a passive accessibility observation marker.
// There is no command channel, fixture branch, or marker in production main.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('XCTest native Requests edge drag, homeowner 100%', (
    tester,
  ) async {
    final fixture = FixtureHarness('homeowner')..install();
    final model = base.model(fixture.auth, fixture.client);
    final semantics = tester.ensureSemantics();
    final lifecycle = _ForegroundCheckpoint();
    WidgetsBinding.instance.addObserver(lifecycle);
    final isolate = developer.Service.getIsolateId(Isolate.current);
    expect(isolate, isNotNull);
    final identity = '${DateTime.now().microsecondsSinceEpoch}|$pid|$isolate';
    final marker = ValueNotifier<String>('N04|$identity|setup');
    try {
      tester.platformDispatcher.textScaleFactorTestValue = 1;
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Stack(
            children: [
              app.BundleenApp(model: model),
              Positioned(
                top: 1,
                right: 1,
                child: IgnorePointer(
                  child: ValueListenableBuilder<String>(
                    valueListenable: marker,
                    builder: (context, value, child) => Semantics(
                      identifier: 'N04Marker',
                      label: value,
                      container: true,
                      child: const SizedBox(width: 2, height: 2),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      // Setup taps are explicitly not native-navigation evidence.
      await tester.tap(find.text('Requests').last);
      await tester.pumpAndSettle();
      final details = find.text('View details').first;
      await tester.ensureVisible(details);
      await tester.pumpAndSettle();
      expect(details.hitTestable(), findsOneWidget);
      await tester.tap(details);
      await tester.pumpAndSettle();
      expect(find.text('Request details'), findsOneWidget);
      expect(model.requests.selectedId, 'r1');
      expect(
        MediaQuery.textScalerOf(tester.element(find.byType(Scaffold)))
            .scale(16),
        16,
      );
      expect(fixture.violations, isEmpty);
      expect(WidgetsBinding.instance.lifecycleState, AppLifecycleState.resumed);
      lifecycle.armed = true;
      marker.value = 'N04|$identity|ready';
      await tester.pump();
      final deadline = DateTime.now().add(const Duration(seconds: 90));
      while (model.requests.selectedId != null &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(
        model.requests.selectedId,
        isNull,
        reason: 'Native edge drag deadline',
      );
      await tester.pumpAndSettle();
      expect(model.showRequests, isTrue);
      expect(model.requests.detail, isNull);
      expect(find.text('Your requests'), findsOneWidget);
      expect(find.text('Request details'), findsNothing);
      expect(developer.Service.getIsolateId(Isolate.current), isolate);
      expect(fixture.violations, isEmpty);
      expect(tester.takeException(), isNull);
      expect(lifecycle.leftForeground, isFalse);
      expect(WidgetsBinding.instance.lifecycleState, AppLifecycleState.resumed);
      marker.value = 'N04|$identity|observed';
      await tester.pump();
      // Leave the correlated result readable by the independent XCTest runner.
      await tester.pump(const Duration(seconds: 15));
    } finally {
      try {
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      } finally {
        try {
          semantics.dispose();
        } finally {
          tester.platformDispatcher.clearTextScaleFactorTestValue();
          WidgetsBinding.instance.removeObserver(lifecycle);
          try {
            marker.dispose();
          } finally {
            try {
              model.dispose();
            } finally {
              fixture.dispose();
            }
          }
        }
      }
      expect(fixture.violations, isEmpty);
    }
  });
}

class _ForegroundCheckpoint extends WidgetsBindingObserver {
  bool armed = false;
  bool leftForeground = false;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (armed && state != AppLifecycleState.resumed) leftForeground = true;
  }
}
