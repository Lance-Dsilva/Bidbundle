// Retained-scroll WidgetTester regressions, never native-input evidence.
import 'package:bundleen/features/inbox/inbox_screen.dart';
import 'package:bundleen/features/requests/requests_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../integration_test/support/list_destinations.dart';
import '../integration_test/support/fixture_harness.dart';
import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;

void main() {
  for (final scale in [1.0, 2.0]) {
    for (final isInbox in [false, true]) {
      testWidgets(
        '${isInbox ? 'Inbox' : 'Requests'} retained list at ${scale}x rejects detail/wrong route',
        (tester) async {
          debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
          tester.view.physicalSize = const Size(390, 844);
          tester.view.devicePixelRatio = 1;
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(() {
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.platformDispatcher.clearTextScaleFactorTestValue();
            debugDefaultTargetPlatformOverride = null;
          });
          final fixture = FixtureHarness('homeowner')..install();
          final model = base.model(fixture.auth, fixture.client);
          void destination() => isInbox
              ? expectInboxListDestination(tester, model)
              : expectRequestsListDestination(tester, model);
          try {
            await fixtures.render(tester, model);
            if (isInbox) {
              await fixtures.tapAndLoad(tester, find.text('Account').last);
              await tester.scrollUntilVisible(
                find.text('Inbox'),
                180,
                scrollable: find.byType(Scrollable).last,
              );
              await tester.ensureVisible(find.text('Inbox'));
              await tester.pumpAndSettle();
              await fixtures.tapAndLoad(tester, find.text('Inbox'));
            } else {
              await fixtures.tapAndLoad(tester, find.text('Requests').last);
            }
            final list = find.byWidgetPredicate(
              (w) => isInbox
                  ? w is InboxScreen && !w.detailView
                  : w is RequestsScreen && !w.detailView,
            );
            final scrollFinder = find
                .descendant(of: list, matching: find.byType(Scrollable))
                .first;
            final button = find.text(
              isInbox ? 'View conversation' : 'View details',
            );
            await tester.scrollUntilVisible(
              button,
              180,
              scrollable: scrollFinder,
            );
            await tester.ensureVisible(button);
            await tester.pumpAndSettle();
            final scroll = tester.state<ScrollableState>(scrollFinder);
            final offset = scroll.position.pixels;
            expect(offset, scale == 1 ? 0 : greaterThan(0));
            final heading = find.text(isInbox ? 'Inbox' : 'Your requests');
            final headingBefore = heading.evaluate().length;
            if (scale == 2 && !isInbox) expect(headingBefore, 0);
            await fixtures.tapAndLoad(tester, button);
            expect(destination, throwsA(isA<TestFailure>()));
            await tester.dragFrom(const Offset(1, 400), const Offset(360, 0));
            await tester.pumpAndSettle();
            expect(scroll.position.pixels, offset);
            expect(heading.evaluate().length, headingBefore);
            destination();
            await fixtures.tapAndLoad(tester, find.text('Home').last);
            expect(destination, throwsA(isA<TestFailure>()));
          } finally {
            try {
              await tester.pumpWidget(const SizedBox.shrink());
            } finally {
              try {
                model.dispose();
              } finally {
                fixture.dispose();
                expect(fixture.violations, isEmpty);
                debugDefaultTargetPlatformOverride = null;
              }
            }
          }
        },
      );
    }
  }
}
