import 'package:flutter/gestures.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'device_sequence.dart';

/// Only instantiated by the native matrix entry point, before other bindings.
class NativeInputBinding extends IntegrationTestWidgetsFlutterBinding {
  DeviceSequence? observer;
  @override
  void dispatchEvent(PointerEvent event, HitTestResult? hitTestResult) {
    try {
      final phase = switch (event) {
        PointerDownEvent() => InputPhase.down,
        PointerMoveEvent() => InputPhase.move,
        PointerUpEvent() => InputPhase.up,
        PointerCancelEvent() => InputPhase.cancel,
        _ => null,
      };
      if (phase != null && observer != null) {
        final view = platformDispatcher.views.singleWhere(
          (v) => v.viewId == event.viewId,
        );
        final size = view.physicalSize / view.devicePixelRatio;
        observer!.record(
          DeviceFact(
            phase,
            device: pointerEventSource == TestBindingEventSource.device,
            touch: event.kind == PointerDeviceKind.touch,
            pointer: event.pointer,
            view: event.viewId,
            x: event.position.dx / size.width,
            y: event.position.dy / size.height,
          ),
        );
      }
    } catch (_) {
      // Observation must never interfere with normal event delivery.
      observer?.fail();
    } finally {
      super.dispatchEvent(event, hitTestResult);
    }
  }
}
