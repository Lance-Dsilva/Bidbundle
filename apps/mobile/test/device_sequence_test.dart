import 'package:flutter_test/flutter_test.dart';

import '../integration_test/support/device_sequence.dart';

DeviceFact fact(
  InputPhase phase, {
  bool device = true,
  bool touch = true,
  int pointer = 1,
  int view = 7,
  double x = .01,
  double y = .5,
}) => DeviceFact(
  phase,
  device: device,
  touch: touch,
  pointer: pointer,
  view: view,
  x: x,
  y: y,
);
void valid(DeviceSequence s) {
  s.record(fact(InputPhase.down));
  s.record(fact(InputPhase.move, x: .5));
  s.record(fact(InputPhase.up, x: .85));
}

void main() {
  test('pre-arm facts cannot establish provenance', () {
    final s = DeviceSequence();
    valid(s);
    expect(s.completed, 0);
    expect(s.summary, isNull);
  });
  test('tester facts ignored even while armed', () {
    final s = DeviceSequence()..arm();
    for (final p in InputPhase.values) {
      s.record(fact(p, device: false));
    }
    expect(s.completed, 0);
    expect(s.invalid, isNull);
    valid(s);
    expect(s.completed, 1);
  });
  test('complete DEVICE touch sequence gives immutable summary', () {
    final s = DeviceSequence()..arm();
    valid(s);
    expect(s.completed, 1);
    expect(s.invalid, isNull);
    expect(s.summary!['source'], 'DEVICE');
    expect(() => s.summary!['completed'] = 2, throwsUnsupportedError);
  });
  for (final phase in [InputPhase.move, InputPhase.up]) {
    test('unbound $phase rejected', () {
      final s = DeviceSequence()..arm();
      s.record(fact(phase));
      expect(s.invalid, isNotNull);
    });
  }
  for (final wrong in ['pointer', 'view']) {
    test('wrong $wrong rejected', () {
      final s = DeviceSequence()..arm();
      s.record(fact(InputPhase.down));
      s.record(
        fact(
          InputPhase.move,
          pointer: wrong == 'pointer' ? 2 : 1,
          view: wrong == 'view' ? 9 : 7,
        ),
      );
      expect(s.invalid, isNotNull);
      expect(s.completed, 0);
    });
  }
  test('cancel invalidates sequence', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.cancel));
    valid(s);
    expect(s.invalid, 'cancelled');
    expect(s.completed, 0);
  });
  test('overlapping pointers rejected', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.down, pointer: 2));
    expect(s.invalid, 'overlapping-pointer');
  });
  test('incomplete movement never completes', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.move, x: .4));
    expect(s.completed, 0);
    s.record(fact(InputPhase.up, x: .4));
    expect(s.invalid, 'incomplete-drag');
  });
  test('down up without move rejected', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.up, x: .85));
    expect(s.invalid, 'incomplete-drag');
  });
  test('replayed duplicate sequence rejected', () {
    final s = DeviceSequence()..arm();
    valid(s);
    valid(s);
    expect(s.invalid, 'duplicate-sequence');
  });
  test('fresh arm resets old success; stale up rejected', () {
    final s = DeviceSequence()..arm();
    valid(s);
    s.arm();
    expect(s.summary, isNull);
    s.record(fact(InputPhase.up, x: .85));
    expect(s.invalid, 'unbound-pointer-view');
  });
  test('disarm ignores later facts without changing frozen summary', () {
    final s = DeviceSequence()..arm();
    valid(s);
    final summary = s.summary;
    s.disarm();
    valid(s);
    expect(s.summary, same(summary));
    expect(s.invalid, isNull);
  });
  for (final f in [
    fact(InputPhase.down, x: .1),
    fact(InputPhase.down, y: .1),
    fact(InputPhase.down, touch: false),
    fact(InputPhase.down, x: double.nan),
  ]) {
    test('invalid origin or input $f rejected', () {
      final s = DeviceSequence()..arm();
      s.record(f);
      expect(s.invalid, isNotNull);
    });
  }
  test('vertical deviation rejected', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.move, x: .5, y: .8));
    expect(s.invalid, 'outside-path');
  });
  test('observer failure latched only when armed', () {
    final s = DeviceSequence();
    s.fail();
    expect(s.invalid, isNull);
    s.arm();
    s.fail();
    valid(s);
    expect(s.invalid, 'observer-failure');
    expect(s.completed, 0);
  });
  test('tester move cannot complete a DEVICE down/up', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.move, device: false, x: .85));
    s.record(fact(InputPhase.up, x: .85));
    expect(s.invalid, 'incomplete-drag');
  });
  test('exact 70 percent is not beyond required width', () {
    final s = DeviceSequence()..arm();
    s.record(fact(InputPhase.down));
    s.record(fact(InputPhase.move, x: .7));
    s.record(fact(InputPhase.up, x: .7));
    expect(s.invalid, 'incomplete-drag');
  });
}
