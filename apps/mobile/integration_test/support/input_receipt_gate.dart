/// Test-only acknowledgement gate. It neither generates nor verifies OS input.
/// Reviewers must independently record the real gesture before acknowledging.
class InputReceiptGate {
  String? _pending;
  bool acknowledged = false;

  void arm(String receipt) {
    if (receipt.isEmpty) throw ArgumentError('Receipt must not be empty');
    _pending = receipt;
    acknowledged = false;
  }

  bool acknowledge(String? receipt) {
    if (_pending == null || receipt != _pending) return false;
    _pending = null;
    acknowledged = true;
    return true;
  }

  void invalidate() {
    _pending = null;
    acknowledged = false;
  }
}
