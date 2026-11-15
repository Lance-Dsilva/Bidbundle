enum InputPhase { down, move, up, cancel }

/// Immutable input facts captured synchronously at dispatch, never commands.
class DeviceFact {
  const DeviceFact(
    this.phase, {
    required this.device,
    required this.touch,
    required this.pointer,
    required this.view,
    required this.x,
    required this.y,
  });
  final InputPhase phase;
  final bool device, touch;
  final int pointer, view;
  final double x, y;
}

class DeviceSequence {
  bool armed = false;
  String? invalid;
  int completed = 0;
  int? _pointer, _view;
  double? _startY, _startX;
  int _moves = 0;
  bool _moved = false;
  Map<String, Object>? _summary;
  Map<String, Object>? get summary => _summary;
  void arm() {
    armed = true;
    invalid = null;
    completed = 0;
    _pointer = null;
    _view = null;
    _startY = null;
    _startX = null;
    _moves = 0;
    _moved = false;
    _summary = null;
  }

  void disarm() => armed = false;
  void fail() {
    if (armed) invalid ??= 'observer-failure';
  }

  void record(DeviceFact f) {
    if (!armed || !f.device || invalid != null) return;
    if (!f.touch || !f.x.isFinite || !f.y.isFinite) {
      invalid = 'invalid-input';
      return;
    }
    if (completed != 0) {
      invalid = 'duplicate-sequence';
      return;
    }
    if (f.phase == InputPhase.cancel) {
      invalid = 'cancelled';
      return;
    }
    if (f.phase == InputPhase.down) {
      if (_pointer != null) {
        invalid = 'overlapping-pointer';
        return;
      }
      if (f.x < 0 || f.x > .03 || f.y < .35 || f.y > .65) {
        invalid = 'wrong-origin';
        return;
      }
      _pointer = f.pointer;
      _view = f.view;
      _startY = f.y;
      _startX = f.x;
      return;
    }
    if (_pointer == null || f.pointer != _pointer || f.view != _view) {
      invalid = 'unbound-pointer-view';
      return;
    }
    if ((f.y - _startY!).abs() > .15 || f.x < 0 || f.x > 1) {
      invalid = 'outside-path';
      return;
    }
    if (f.phase == InputPhase.move) {
      _moved = true;
      _moves++;
    }
    if (f.phase == InputPhase.up) {
      if (!_moved || f.x <= .70) {
        invalid = 'incomplete-drag';
        return;
      }
      completed = 1;
      _summary = Map.unmodifiable({
        'pointer': f.pointer,
        'startX': _startX!,
        'startY': _startY!,
        'downCount': 1,
        'moveCount': _moves,
        'upCount': 1,
        'view': f.view,
        'endX': f.x,
        'endY': f.y,
        'source': 'DEVICE',
        'completed': 1,
      });
    }
  }
}
