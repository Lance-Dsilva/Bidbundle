import 'package:flutter/services.dart';

abstract interface class AuthSession {
  Future<bool> initialize(String publishableKey);
  Future<void> signIn();
  Future<void> signUp();
  Future<String?> token({bool forceRefresh = false});
  Future<void> signOut();
}

/// Native SDKs own browser authentication, renewal and OS-protected persistence.
/// No password, long-lived credential or token is saved in Dart.
class NativeAuthSession implements AuthSession {
  static const _channel = MethodChannel('bundleen/auth');
  @override
  Future<bool> initialize(String publishableKey) async =>
      await _channel.invokeMethod<bool>('initialize', {
        'publishableKey': publishableKey,
      }) ??
      false;
  @override
  Future<void> signIn() => _channel.invokeMethod<void>('signIn');
  @override
  Future<void> signUp() => _channel.invokeMethod<void>('signUp');
  @override
  Future<String?> token({bool forceRefresh = false}) =>
      _channel.invokeMethod<String>('getToken', {'forceRefresh': forceRefresh});
  @override
  Future<void> signOut() => _channel.invokeMethod<void>('signOut');
}
