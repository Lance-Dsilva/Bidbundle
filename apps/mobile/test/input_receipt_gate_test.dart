import 'package:flutter_test/flutter_test.dart';

import '../integration_test/support/input_receipt_gate.dart';

void main() {
  test('no pending checkpoint rejects missing or unsolicited receipts', () {
    final gate = InputReceiptGate();
    expect(gate.acknowledge(null), isFalse);
    expect(gate.acknowledge('unsolicited'), isFalse);
    expect(gate.acknowledged, isFalse);
  });
  test('wrong receipt leaves the correct pending checkpoint available', () {
    final gate = InputReceiptGate()..arm('current');
    expect(gate.acknowledge('wrong'), isFalse);
    expect(gate.acknowledge(null), isFalse);
    expect(gate.acknowledged, isFalse);
    expect(gate.acknowledge('current'), isTrue);
    expect(gate.acknowledged, isTrue);
  });
  test('accepted receipt cannot be replayed', () {
    final gate = InputReceiptGate()..arm('one');
    expect(gate.acknowledge('one'), isTrue);
    expect(gate.acknowledge('one'), isFalse);
    expect(gate.acknowledge('another'), isFalse);
    expect(gate.acknowledged, isTrue);
  });
  test('fresh arm clears acknowledgement and rejects stale receipt', () {
    final gate = InputReceiptGate()..arm('old');
    expect(gate.acknowledge('old'), isTrue);
    gate.arm('new');
    expect(gate.acknowledged, isFalse);
    expect(gate.acknowledge('old'), isFalse);
    expect(gate.acknowledge('new'), isTrue);
  });
  test('rearming a pending checkpoint rejects its previous receipt', () {
    final gate = InputReceiptGate()
      ..arm('old')
      ..arm('new');
    expect(gate.acknowledge('old'), isFalse);
    expect(gate.acknowledged, isFalse);
    expect(gate.acknowledge('new'), isTrue);
  });
  test('teardown invalidates pending and accepted state', () {
    final gate = InputReceiptGate()
      ..arm('pending')
      ..invalidate();
    expect(gate.acknowledge('pending'), isFalse);
    expect(gate.acknowledged, isFalse);
    gate.arm('accepted');
    expect(gate.acknowledge('accepted'), isTrue);
    gate.invalidate();
    expect(gate.acknowledged, isFalse);
    expect(gate.acknowledge('accepted'), isFalse);
  });
  test('empty receipt cannot arm a checkpoint', () {
    final gate = InputReceiptGate();
    expect(() => gate.arm(''), throwsArgumentError);
    expect(gate.acknowledge(''), isFalse);
  });
}
