import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:isolate';
import 'dart:ui' as ui;

import 'package:bundleen/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bundleen/features/home/home_model.dart';

import '../test/mobile_test.dart' as base;
import 'support/fixture_harness.dart';

import 'support/device_sequence.dart';
import 'support/account_destination.dart';
import 'support/native_input_binding.dart';

void main() {
  final binding = NativeInputBinding();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('XCTest eight native edge drags, homeowner 100% and 200%', (
    tester,
  ) async {
    expect(WidgetsBinding.instance.runtimeType, NativeInputBinding);
    final semantics = tester.ensureSemantics();
    ui.PlatformDispatcher.instance.setSemanticsTreeEnabled(true);
    final lifecycle = _ForegroundCheckpoint();
    WidgetsBinding.instance.addObserver(lifecycle);
    final isolate = developer.Service.getIsolateId(Isolate.current);
    expect(isolate, isNotNull);
    final identity = '${DateTime.now().microsecondsSinceEpoch}|$pid|$isolate';
    final marker = ValueNotifier<String>(
      'N04|$identity|100|1|requests|setup|0',
    );
    final sequence = DeviceSequence();
    final content = ValueNotifier<Widget>(const SizedBox.expand());
    final pointerFacts = ValueNotifier<String>('{}');
    final prior = binding.shouldPropagateDevicePointerEvents;
    FixtureHarness? currentFixture;
    HomeModel? currentModel;
    var step = 0;
    var scale = 1;
    var name = 'requests';
    void publish(String phase) {
      marker.value =
          'N04|$identity|${scale * 100}|$step|$name|$phase|${sequence.completed}';
      debugPrint(
        jsonEncode({
          'event': 'N04_DART_$phase',
          'marker': marker.value,
          'devicePointerPropagation':
              binding.shouldPropagateDevicePointerEvents,
          'sequence': sequence.summary,
          'invalid': sequence.invalid,
        }),
      );
    }

    void guards() {
      expect(developer.Service.getIsolateId(Isolate.current), isolate);
      expect(lifecycle.leftForeground, isFalse);
      expect(WidgetsBinding.instance.lifecycleState, AppLifecycleState.resumed);
      expect(currentFixture!.violations, isEmpty);
      expect(tester.takeException(), isNull);
      expect(binding.shouldPropagateDevicePointerEvents, isTrue);
      expect(
        MediaQuery.textScalerOf(tester.element(find.byType(Scaffold)))
            .scale(16),
        16 * scale,
      );
    }

    Future<void> hold(Duration duration) async {
      final elapsed = Stopwatch()..start();
      while (elapsed.elapsed < duration) {
        await tester.pump(const Duration(milliseconds: 100));
        guards();
        expect(sequence.invalid, isNull);
      }
    }

    Future<void> settle() async {
      final elapsed = Stopwatch()..start();
      do {
        if (elapsed.elapsed >= const Duration(seconds: 10)) {
          throw StateError('Fixture layout deadline');
        }
        await tester.pump(const Duration(milliseconds: 100));
      } while (binding.hasScheduledFrame);
    }

    Future<void> setupTap(String label) async {
      final raw = find.text(label);
      if (raw.evaluate().isEmpty) {
        await tester.scrollUntilVisible(
          raw,
          180,
          scrollable: find.byType(Scrollable).last,
        );
      }
      await settle();
      await tester.ensureVisible(raw.last);
      await settle();
      expect(raw.last.hitTestable(), findsOneWidget);
      await tester.tap(raw.last);
      await settle();
    }

    void privateClear() {
      final m = currentModel!;
      expect(m.signedIn, isFalse);
      expect(m.logoutPending, isFalse);
      expect(m.data, isNull);
      expect(m.status, HomeStatus.signedOut);
      expect(m.message, isNull);
      expect(m.busy, isFalse);
      expect(currentFixture!.auth.active, isFalse);
      expect(m.requests.selectedId, isNull);
      expect(m.requests.detail, isNull);
      expect(m.requests.items, isEmpty);
      expect(m.inbox.selectedId, isNull);
      expect(m.inbox.detail, isNull);
      expect(m.inbox.items, isEmpty);
      expect(m.account.profile, isNull);
      expect([
        m.account.inboxAvailable,
        m.account.reviewsAvailable,
        m.account.serviceAreasAvailable,
        m.canViewRequests,
        m.canViewCommunity,
        m.canViewOpportunities,
        m.canViewProvider,
        m.canViewAccount,
        m.canViewInbox,
        m.canViewReviews,
        m.canViewServiceAreas,
        m.canViewSupport,
      ], everyElement(isFalse));
      expect([
        m.requests.eligibilityMessage,
        m.requests.listMessage,
        m.requests.detailMessage,
        m.inbox.listMessage,
        m.inbox.detailMessage,
        m.support.listMessage,
        m.support.detailMessage,
        m.account.profileMessage,
        m.account.notificationsMessage,
        m.provider.message,
        m.community.message,
        m.opportunities.message,
        m.serviceAreas.message,
        m.reviews.message,
      ], everyElement(isNull));
      expect([
        m.requests.listStatus.name,
        m.requests.detailStatus.name,
        m.inbox.listStatus.name,
        m.inbox.detailStatus.name,
        m.support.listStatus.name,
        m.support.detailStatus.name,
        m.account.profileStatus.name,
        m.account.notificationsStatus.name,
        m.provider.status.name,
        m.community.status.name,
        m.opportunities.status.name,
        m.serviceAreas.status.name,
        m.reviews.status.name,
      ], everyElement('idle'));
      expect(m.account.notifications, isEmpty);
      expect([
        m.showAccount,
        m.showRequests,
        m.showCommunity,
        m.showOpportunities,
        m.account.showingInbox,
        m.account.showingNotifications,
        m.account.showingSupport,
        m.account.showingReviews,
        m.account.showingServiceAreas,
      ], everyElement(isFalse));
      expect(m.support.items, isEmpty);
      expect(m.support.detail, isNull);
      expect(m.support.selectedId, isNull);
      expect(m.serviceAreas.items, isEmpty);
      expect(m.reviews.page, isNull);
      expect(m.provider.overview, isNull);
      expect(m.community.hub, isNull);
      expect(m.community.expandedId, isNull);
      expect(m.opportunities.feed, isNull);
      expect(m.opportunities.expandedId, isNull);
      expect(find.text('Sign in'), findsOneWidget);
      for (final label in [
        'Request details',
        'Conversation',
        'Your requests',
        'Inbox',
      ]) {
        expect(find.text(label), findsNothing);
      }
    }

    Future<void> external(
      String stepName,
      bool Function() done,
      void Function() destination, {
      bool signedOut = false,
    }) async {
      step++;
      name = stepName;
      guards();
      lifecycle.armed = true;
      sequence.arm();
      binding.observer = sequence;
      publish('ready');
      await tester.pump();
      final node = tester.getSemantics(
        find.byKey(const ValueKey('n04-marker')),
      );
      expect(node.identifier, 'N04Marker');
      expect(node.label, marker.value);
      final elapsed = Stopwatch()..start();
      while ((sequence.completed != 1 || !done()) &&
          elapsed.elapsed < const Duration(seconds: 90)) {
        await tester.pump(const Duration(milliseconds: 100));
        guards();
        expect(sequence.invalid, isNull);
      }
      expect(sequence.completed, 1);
      expect(sequence.invalid, isNull);
      expect(done(), isTrue);
      if (signedOut) await hold(const Duration(seconds: 2));
      await settle();
      guards();
      destination();
      pointerFacts.value = jsonEncode({
        'identity': identity,
        'scale': scale * 100,
        'step': step,
        'name': name,
        ...sequence.summary!,
      });
      publish('observed');
      await tester.pump();
      await hold(const Duration(seconds: 15));
      sequence.disarm();
      binding.observer = null;
    }

    Future<void> releaseFixture() async {
      try {
        content.value = const SizedBox.expand();
        await tester.pump();
      } finally {
        try {
          currentModel?.dispose();
        } finally {
          currentModel = null;
          final fixture = currentFixture;
          currentFixture = null;
          fixture?.dispose();
          expect(fixture?.violations ?? [], isEmpty);
        }
      }
    }

    Widget passive(
      String identifier,
      ValueNotifier<String> value,
      String label,
    ) => IgnorePointer(
      child: ValueListenableBuilder<String>(
        valueListenable: value,
        builder: (context, text, child) => Semantics(
          key: identifier == 'N04Marker' ? const ValueKey('n04-marker') : null,
          identifier: identifier,
          label: text,
          container: true,
          excludeSemantics: true,
          child: Container(
            width: 180,
            height: 24,
            color: const Color(0xFFEEEEEE),
            alignment: Alignment.center,
            child: Text(
              identifier == 'N04Marker' ? 'N04: ${text.split('|')[7]}' : label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF000000)),
            ),
          ),
        ),
      ),
    );
    try {
      binding.shouldPropagateDevicePointerEvents = true;
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Stack(
            fit: StackFit.expand,
            children: [
              ValueListenableBuilder<Widget>(
                valueListenable: content,
                builder: (context, value, child) => value,
              ),
              Positioned(
                top:
                    tester.view.padding.top / tester.view.devicePixelRatio + 64,
                right: 16,
                child: passive('N04Marker', marker, ''),
              ),
              Positioned(
                top:
                    tester.view.padding.top / tester.view.devicePixelRatio + 90,
                right: 16,
                child: passive(
                  'N04PointerFacts',
                  pointerFacts,
                  'N04 input audit',
                ),
              ),
            ],
          ),
        ),
      );
      for (scale = 1; scale <= 2; scale++) {
        // Fresh synthetic auth/model is setup, not a relaunch or persistence test.
        final fixture = FixtureHarness('homeowner')..install();
        currentFixture = fixture;
        final model = base.model(fixture.auth, fixture.client);
        currentModel = model;
        sequence.disarm();
        name = 'requests';
        marker.value = 'N04|$identity|${scale * 100}|${step + 1}|$name|setup|0';
        tester.platformDispatcher.textScaleFactorTestValue = scale.toDouble();
        content.value = app.BundleenApp(key: ValueKey(scale), model: model);
        await tester.pump();
        await settle();
        await setupTap('Requests');
        await setupTap('View details');
        expect(model.requests.selectedId, 'r1');
        expect(find.text('Request details'), findsOneWidget);
        await external('requests', () => model.requests.selectedId == null, () {
          expect(model.requests.detail, isNull);
          expect(model.showRequests, isTrue);
          expect(find.text('Your requests'), findsOneWidget);
          expect(find.text('Request details'), findsNothing);
        });
        await setupTap('Account');
        await setupTap('Inbox');
        await setupTap('View conversation');
        expect(model.inbox.selectedId, 't1');
        expect(find.text('Conversation'), findsOneWidget);
        await external(
          'inbox-detail',
          () => model.inbox.selectedId == null,
          () {
            expect(model.inbox.detail, isNull);
            expect(model.account.showingInbox, isTrue);
            expect(find.text('Inbox'), findsOneWidget);
            expect(find.text('Conversation'), findsNothing);
          },
        );
        await external('inbox-list', () => !model.account.showingInbox, () {
          expectCurrentAccountDestination(tester, model);
        });
        await setupTap('Home');
        await setupTap('Account');
        await setupTap('Inbox');
        await setupTap('View conversation');
        await setupTap('Sign out');
        privateClear();
        await external('signed-out', () => true, privateClear, signedOut: true);
        if (scale == 2) {
          guards();
          privateClear();
          publish('complete');
          await tester.pump();
          await hold(const Duration(seconds: 15));
        }
        await releaseFixture();
      }
    } catch (_) {
      publish('failed');
      await tester.pump();
      rethrow;
    } finally {
      sequence.disarm();
      binding.observer = null;
      binding.shouldPropagateDevicePointerEvents = prior;
      try {
        await releaseFixture();
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
            marker.dispose();
            content.dispose();
            pointerFacts.dispose();
          }
        }
      }
    }
  });
}

class _ForegroundCheckpoint extends WidgetsBindingObserver {
  bool armed = false, leftForeground = false;
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (armed && state != AppLifecycleState.resumed) leftForeground = true;
  }
}
