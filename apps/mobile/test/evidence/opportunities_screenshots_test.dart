// Fake-backed widget captures only; these are NOT device or live-auth evidence.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';

import 'package:bundleen/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';

import '../mobile_test.dart' as fixture;
import '../opportunities_test.dart' as opportunities;

void main() {
  setUpAll(() async {
    var directory = File(Platform.resolvedExecutable).parent;
    File? font;
    for (var depth = 0; depth < 10; depth++) {
      final candidate = File(
        '${directory.path}/bin/cache/artifacts/material_fonts/Roboto-Regular.ttf',
      );
      if (candidate.existsSync()) {
        font = candidate;
        break;
      }
      directory = directory.parent;
    }
    if (font == null) {
      throw StateError('Flutter SDK Roboto fixture font not found');
    }
    final icons = FontLoader('MaterialIcons');
    icons.addFont(
      Future.value(
        ByteData.sublistView(
          await File('${font.parent.path}/MaterialIcons-Regular.otf')
              .readAsBytes(),
        ),
      ),
    );
    await icons.load();
    for (final family in ['Ahem', 'Roboto', 'serif']) {
      final loader = FontLoader(family);
      loader.addFont(
        Future.value(ByteData.sublistView(await font.readAsBytes())),
      );
      await loader.load();
    }
  });
  for (final scenario in [
    'opportunities',
    'opportunities-ineligible',
    'opportunities-empty',
    'opportunities-large-text',
  ]) {
    testWidgets('fake widget capture $scenario', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue =
          scenario == 'opportunities-large-text' ? 2 : 1;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final auth = fixture.FakeAuth()..active = true;
      final vm = fixture.model(
        auth,
        MockClient(
          (r) async => opportunities.opportunityRoute(
            r,
            data: scenario == 'opportunities-ineligible'
                ? opportunities.workspace(eligible: false)
                : scenario == 'opportunities-empty'
                ? opportunities.workspace(rows: [])
                : null,
          ),
        ),
      );
      final boundaryKey = GlobalKey();
      await tester.runAsync(() async {
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundaryKey,
            child: BundleenApp(model: vm),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 30));
      });
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await vm.openOpportunities();
        if (scenario == 'opportunities' ||
            scenario == 'opportunities-large-text') {
          vm.opportunities.toggleExpanded('r1');
        }
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final output = Directory('build/evidence/opportunities-fixtures');
        await output.create(recursive: true);
        await File('${output.path}/$scenario.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    });
  }
}
