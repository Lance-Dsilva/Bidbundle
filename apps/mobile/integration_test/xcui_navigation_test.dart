import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:isolate';
import 'dart:ui' as ui;

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
    // The pinned TestPlatformDispatcher does not forward this public method.
    // Notify the real engine before the fixture sends its first semantics tree.
    // This is test-entry-only and never turns user accessibility off.
    ui.PlatformDispatcher.instance.setSemanticsTreeEnabled(true);
    final lifecycle = _ForegroundCheckpoint();
    WidgetsBinding.instance.addObserver(lifecycle);
    final isolate = developer.Service.getIsolateId(Isolate.current);
    expect(isolate, isNotNull);
    final identity = '${DateTime.now().microsecondsSinceEpoch}|$pid|$isolate';
    final marker = ValueNotifier<String>('N04|$identity|setup');
    var phase = 'setup';
    void milestone(String event) => debugPrint(
      jsonEncode({
        'event': event,
        'phase': phase,
        'identity': identity,
        'lifecycle': WidgetsBinding.instance.lifecycleState?.name,
      }),
    );
    void assertMarker() {
      final node = tester.getSemantics(
        find.byKey(const ValueKey('n04-marker')),
      );
      expect(node.identifier, 'N04Marker');
      expect(node.label, marker.value);
      expect(node.rect.width, greaterThan(0));
      expect(node.rect.height, greaterThanOrEqualTo(24));
    }

    milestone('N04_DART_SETUP');
    try {
      tester.platformDispatcher.textScaleFactorTestValue = 1;
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Stack(
            children: [
              app.BundleenApp(model: model),
              Positioned(
                top:
                    tester.view.padding.top / tester.view.devicePixelRatio + 64,
                right: 16,
                child: IgnorePointer(
                  child: ValueListenableBuilder<String>(
                    valueListenable: marker,
                    builder: (context, value, child) => Semantics(
                      key: const ValueKey('n04-marker'),
                      identifier: 'N04Marker',
                      label: value,
                      container: true,
                      excludeSemantics: true,
                      child: Container(
                        width: 180,
                        height: 24,
                        color: const Color(0xFFEEEEEE),
                        alignment: Alignment.center,
                        child: Text(
                          'N04 fixture: ${value.split('|').last}',
                          style: const TextStyle(
                            color: Color(0xFF000000),
                            fontSize: 12,
                          ),
                          textDirection: TextDirection.ltr,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      assertMarker();
      milestone('N04_DART_SETUP_SEMANTICS');
      // Setup taps are explicitly not native-navigation evidence.
      await tester.tap(find.text('Requests').last);
      await tester.pumpAndSettle();
      final details = find.text('View details').first;
      await tester.ensureVisible(details);
      await tester.pumpAndSettle();
      expect(details.hitTestable(), findsOneWidget);
      await tester.tap(details);
      await tester.pumpAndSettle();
      phase = 'detail-setup';
      milestone('N04_DART_DETAIL_SETUP');
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
      assertMarker();
      phase = 'ready';
      milestone('N04_DART_READY');
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
      assertMarker();
      phase = 'observed';
      milestone('N04_DART_OBSERVED');
      // Leave the correlated result readable by the independent XCTest runner.
      await tester.pump(const Duration(seconds: 15));
    } catch (_) {
      milestone('N04_DART_FAILURE');
      rethrow;
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
