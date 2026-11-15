// Real flavor boundary tests; values below are synthetic and never contacted.
import 'dart:io';

import 'package:bundleen/core/config.dart';
import 'package:bundleen/main.dart' as app;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class DenyNetwork extends HttpOverrides {
  int calls = 0;
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    calls++;
    throw StateError('Network prohibited in configuration test');
  }
}

void main() {
  for (final flavor in ['development', 'staging']) {
    test('matching $flavor accepted with testkey', () {
      expect(
        AppConfig.forFlavor(
          flavor: flavor,
          environment: flavor,
          apiOrigin: 'https://api.example.invalid',
          publishableKey: 'pk_test_fixture',
        ).environment,
        flavor,
      );
    });
  }
  for (final flavor in [
    null,
    '',
    'production',
    'unknown',
    'development',
    'staging',
  ]) {
    for (final environment in ['', 'production', 'development', 'staging']) {
      if (flavor == environment &&
          ['development', 'staging'].contains(flavor)) {
        continue;
      }
      test('reject flavor=$flavor environment=$environment', () {
        expect(
          () => AppConfig.forFlavor(
            flavor: flavor,
            environment: environment,
            apiOrigin: 'https://api.example.invalid',
            publishableKey: 'pk_test_fixture',
          ),
          throwsFormatException,
        );
      });
    }
  }
  test('matching flavor still validates origin and key', () {
    for (final input in [
      ('', 'pk_test_fixture'),
      ('https://api.example.invalid', ''),
      ('https://api.example.invalid', 'pk_live_fixture'),
      ('http://api.example.invalid', 'pk_test_fixture'),
    ]) {
      expect(
        () => AppConfig.forFlavor(
          flavor: 'staging',
          environment: 'staging',
          apiOrigin: input.$1,
          publishableKey: input.$2,
        ),
        throwsFormatException,
      );
    }
  });
  testWidgets('real compiled entrypoint rejects before auth and network', (
    tester,
  ) async {
    const accepts = bool.fromEnvironment('EXPECT_CONFIG_ACCEPT');
    if (accepts) {
      final config = AppConfig.fromEnvironment();
      expect(config.environment, const String.fromEnvironment('BUNDLEEN_ENV'));
      return;
    }
    expect(AppConfig.fromEnvironment, throwsFormatException);
    const channel = MethodChannel('bundleen/auth');
    var authCalls = 0;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(channel, (call) async {
      authCalls++;
      throw StateError('Native auth prohibited');
    });
    final previous = HttpOverrides.current;
    final deny = DenyNetwork();
    HttpOverrides.global = deny;
    try {
      app.main();
      await tester.pumpAndSettle();
      expect(
        find.textContaining('This build needs a configured environment'),
        findsOneWidget,
      );
      expect(authCalls, 0);
      expect(deny.calls, 0);
    } finally {
      messenger.setMockMethodCallHandler(channel, null);
      HttpOverrides.global = previous;
    }
  });
}
