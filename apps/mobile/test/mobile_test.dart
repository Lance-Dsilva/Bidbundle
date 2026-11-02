import 'dart:async';
import 'dart:convert';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/core/auth.dart';
import 'package:bundleen/core/config.dart';
import 'package:bundleen/features/home/home_model.dart';
import 'package:bundleen/features/home/models.dart';
import 'package:bundleen/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class StreamClient extends http.BaseClient {
  StreamClient(this.handler);
  final Future<http.StreamedResponse> Function(http.BaseRequest) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      handler(request);
}

class FakeAuth implements AuthSession {
  bool active = false;
  int tokenCalls = 0;
  final refreshFlags = <bool>[];
  bool failSignOut = false;
  bool failInitialize = false;
  int signInCalls = 0;
  @override
  Future<bool> initialize(String key) async {
    if (failInitialize) throw StateError("init failed");
    return active;
  }

  @override
  Future<void> signIn() async {
    signInCalls++;
    active = true;
  }

  @override
  Future<void> signUp() => signIn();
  @override
  Future<String?> token({bool forceRefresh = false}) async {
    refreshFlags.add(forceRefresh);
    tokenCalls++;
    return active ? 'test-token' : null;
  }

  @override
  Future<void> signOut() async {
    if (failSignOut) throw StateError('offline');
    active = false;
  }
}

AppConfig config() => AppConfig(
  environment: 'staging',
  apiOrigin: 'https://api.example.test',
  publishableKey: 'pk_test_example',
);
Matcher failure(FailureKind kind) =>
    isA<ApiFailure>().having((e) => e.kind, 'kind', kind);
http.Response jsonResponse(Object value) => http.Response(
  jsonEncode(value),
  200,
  headers: {'content-type': 'application/json'},
);
Map<String, Object> profile([String role = 'homeowner']) => {
  'id': 'u1',
  'fullName': 'Test Resident',
  'role': role,
};
Map<String, Object> context([String role = 'homeowner']) => {
  'userId': 'u1',
  'role': role,
  'roleLabel': role,
  'canManageCommunity': false,
};
Map<String, Object> dashboard() => {
  'cold_start': false,
  'active_requests': 2,
  'active_bids': 3,
  'total_saved_cents': 1250,
};
http.Response route(http.Request r) => jsonResponse(switch (r.url.path) {
  '/api/profile' => profile(),
  '/api/me/context' => context(),
  _ => dashboard(),
});
HomeModel model(FakeAuth auth, http.Client client) => HomeModel(
  config(),
  auth,
  HomeRepository(ApiClient(config(), auth, client)),
);

void main() {
  group('configuration fails closed', () {
    test(
      'missing compile configuration has no production fallback',
      () => expect(AppConfig.fromEnvironment, throwsFormatException),
    );
    for (final origin in [
      'http://api.example.test',
      'https://user:password@api.example.test',
      'https://api.example.test/path',
      'https://api.example.test?x=1',
      'https://api.example.test#fragment',
      '',
    ]) {
      test(
        'rejects $origin',
        () => expect(
          () => AppConfig(
            environment: 'staging',
            apiOrigin: origin,
            publishableKey: 'pk_test_example',
          ),
          throwsFormatException,
        ),
      );
    }
    test('rejects live key in staging and unknown environment', () {
      expect(
        () => AppConfig(
          environment: 'staging',
          apiOrigin: 'https://api.example.test',
          publishableKey: 'pk_live_example',
        ),
        throwsFormatException,
      );
      expect(
        () => AppConfig(
          environment: 'preview',
          apiOrigin: 'https://api.example.test',
          publishableKey: 'pk_test_example',
        ),
        throwsFormatException,
      );
    });
  });
  group('contracts and isolation', () {
    test('strict required fields and nonnegative integer totals', () {
      expect(
        () => Profile.fromJson({
          'id': 'u1',
          'fullName': null,
          'role': 'homeowner',
        }),
        throwsA(failure(FailureKind.invalidResponse)),
      );
      expect(
        () => ViewerContext.fromJson({
          ...context(),
          'canManageCommunity': 'true',
        }),
        throwsA(failure(FailureKind.invalidResponse)),
      );
      for (final invalid in [-1, 1.5, '2', null]) {
        expect(
          () =>
              Dashboard.fromJson({...dashboard(), 'active_requests': invalid}),
          throwsA(failure(FailureKind.invalidResponse)),
        );
      }
      for (final payload in [
        dashboard()..remove('total_saved_cents'),
        {...dashboard(), 'total_saved_cents': 'unusable'},
      ]) {
        expect(Dashboard.fromJson(payload).activeRequests, 2);
        expect(Dashboard.fromJson(payload).activeBids, 3);
      }
    });
    for (final change in [
      {'userId': 'u2'},
      {'role': 'provider'},
    ]) {
      test(
        'rejects mismatched identity/role before protected read $change',
        () async {
          final paths = <String>[];
          final auth = FakeAuth()..active = true;
          final repo = HomeRepository(
            ApiClient(
              config(),
              auth,
              MockClient((r) async {
                paths.add(r.url.path);
                return jsonResponse(
                  r.url.path == '/api/profile'
                      ? profile()
                      : {...context(), ...change},
                );
              }),
            ),
          );
          await expectLater(
            repo.load(),
            throwsA(failure(FailureKind.invalidResponse)),
          );
          expect(paths, ['/api/profile', '/api/me/context']);
        },
      );
    }
    test('provider context never calls homeowner dashboard', () async {
      final paths = <String>[];
      final auth = FakeAuth()..active = true;
      final data = await HomeRepository(
        ApiClient(
          config(),
          auth,
          MockClient((r) async {
            paths.add(r.url.path);
            return jsonResponse(
              r.url.path == '/api/profile'
                  ? profile('provider')
                  : context('provider'),
            );
          }),
        ),
      ).load();
      expect(data.dashboard, isNull);
      expect(paths.length, 2);
    });
  });
  group('transport', () {
    test(
      'slow body deadline cancels stream even while chunks arrive',
      () async {
        var cancelled = false;
        late Timer timer;
        final stream = StreamController<List<int>>(
          onCancel: () {
            cancelled = true;
            timer.cancel();
          },
        );
        timer = Timer.periodic(
          const Duration(milliseconds: 2),
          (_) => stream.add([32]),
        );
        final auth = FakeAuth()..active = true;
        final api = ApiClient(
          config(),
          auth,
          StreamClient(
            (_) async => http.StreamedResponse(
              stream.stream,
              200,
              headers: {'content-type': 'application/json'},
            ),
          ),
          timeout: const Duration(milliseconds: 20),
        );
        await expectLater(
          api.get('/api/profile'),
          throwsA(failure(FailureKind.network)),
        );
        expect(cancelled, isTrue);
        await stream.close();
      },
    );
    test('late send response after timeout is cancelled', () async {
      var cancelled = false;
      final response = Completer<http.StreamedResponse>();
      final stream = StreamController<List<int>>(
        onCancel: () {
          cancelled = true;
        },
      );
      final auth = FakeAuth()..active = true;
      final api = ApiClient(
        config(),
        auth,
        StreamClient((_) => response.future),
        timeout: const Duration(milliseconds: 5),
      );
      await expectLater(
        api.get('/api/profile'),
        throwsA(failure(FailureKind.network)),
      );
      response.complete(http.StreamedResponse(stream.stream, 200));
      await Future<void>.delayed(Duration.zero);
      expect(cancelled, isTrue);
      await stream.close();
    });
    test('401 requests one replacement SDK token then stops', () async {
      final auth = FakeAuth()..active = true;
      var calls = 0;
      final api = ApiClient(
        config(),
        auth,
        MockClient((r) async {
          calls++;
          return http.Response('', 401);
        }),
      );
      await expectLater(
        api.get('/api/profile'),
        throwsA(failure(FailureKind.unauthenticated)),
      );
      expect(calls, 2);
      expect(auth.tokenCalls, 2);
      expect(auth.refreshFlags, [false, true]);
    });
    test('missing session sends no request', () async {
      var calls = 0;
      final api = ApiClient(
        config(),
        FakeAuth(),
        MockClient((r) async {
          calls++;
          return route(r);
        }),
      );
      await expectLater(
        api.get('/api/profile'),
        throwsA(failure(FailureKind.unauthenticated)),
      );
      expect(calls, 0);
    });
    test('redirect disabled and external location never requested', () async {
      final auth = FakeAuth()..active = true;
      var calls = 0;
      final api = ApiClient(
        config(),
        auth,
        MockClient((r) async {
          calls++;
          expect(r.followRedirects, isFalse);
          expect(r.url.host, 'api.example.test');
          expect(r.headers['Authorization'], 'Bearer test-token');
          return http.Response(
            '',
            302,
            headers: {'location': 'https://evil.example.test'},
          );
        }),
      );
      await expectLater(
        api.get('/api/profile'),
        throwsA(failure(FailureKind.invalidResponse)),
      );
      expect(calls, 1);
      await expectLater(
        api.get('https://evil.example.test/api/profile'),
        throwsA(failure(FailureKind.invalidResponse)),
      );
      expect(calls, 1);
    });
    test('HTML, array and oversized payloads rejected', () async {
      for (final response in [
        http.Response(
          '<html>login</html>',
          200,
          headers: {'content-type': 'text/html'},
        ),
        jsonResponse([]),
        jsonResponse({'large': 'x' * ApiClient.maxResponseBytes}),
      ]) {
        final auth = FakeAuth()..active = true;
        await expectLater(
          ApiClient(
            config(),
            auth,
            MockClient((_) async => response),
          ).get('/api/profile'),
          throwsA(failure(FailureKind.invalidResponse)),
        );
      }
    });
    test('timeout maps to network failure', () async {
      final auth = FakeAuth()..active = true;
      final api = ApiClient(
        config(),
        auth,
        MockClient((_) => Completer<http.Response>().future),
        timeout: const Duration(milliseconds: 5),
      );
      await expectLater(
        api.get('/api/profile'),
        throwsA(failure(FailureKind.network)),
      );
    });
    for (final entry in {
      403: FailureKind.forbidden,
      409: FailureKind.profileIncomplete,
      429: FailureKind.rateLimited,
      503: FailureKind.server,
    }.entries) {
      test('maps ${entry.key} without retry', () async {
        var calls = 0;
        final auth = FakeAuth()..active = true;
        await expectLater(
          ApiClient(
            config(),
            auth,
            MockClient((_) async {
              calls++;
              return http.Response('', entry.key);
            }),
          ).get('/api/profile'),
          throwsA(failure(entry.value)),
        );
        expect(calls, 1);
      });
    }
  });
  group('session state', () {
    test(
      'failed initialization blocks authentication until successful retry',
      () async {
        final auth = FakeAuth()..failInitialize = true;
        final vm = model(auth, MockClient((r) async => route(r)));
        await vm.initialize();
        await vm.authenticate();
        expect(vm.initialized, isFalse);
        expect(auth.signInCalls, 0);
        auth.failInitialize = false;
        await vm.initialize();
        expect(vm.initialized, isTrue);
        await vm.authenticate();
        expect(auth.signInCalls, 1);
        expect(vm.status, HomeStatus.ready);
        vm.dispose();
      },
    );
    test('late load cannot restore account after signout', () async {
      final pending = Completer<http.Response>();
      final auth = FakeAuth()..active = true;
      final vm = model(auth, MockClient((_) => pending.future));
      final loading = vm.initialize();
      await Future<void>.delayed(Duration.zero);
      await vm.signOut();
      pending.complete(jsonResponse(profile()));
      await loading;
      expect(vm.status, HomeStatus.signedOut);
      expect(vm.data, isNull);
      expect(vm.signedIn, isFalse);
      vm.dispose();
    });
    test('unconfirmed signout clears data and warns', () async {
      final auth = FakeAuth()..active = true;
      final vm = model(auth, MockClient((r) async => route(r)));
      await vm.initialize();
      auth.failSignOut = true;
      await vm.signOut();
      expect(vm.data, isNull);
      expect(vm.message, contains('could not be confirmed'));
      expect(vm.logoutPending, isTrue);
      await vm.authenticate();
      expect(auth.signInCalls, 0);
      auth.failSignOut = false;
      await vm.signOut();
      expect(vm.logoutPending, isFalse);
      vm.dispose();
    });
  });
  testWidgets('signed-out screen scales to 200 percent with no overflow', (
    tester,
  ) async {
    final vm = model(FakeAuth(), MockClient((r) async => route(r)));
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(BundleenApp(model: vm));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Active requests'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
  });
  testWidgets('server denial offers retry and no protected data', (
    tester,
  ) async {
    final auth = FakeAuth()..active = true;
    final vm = model(auth, MockClient((_) async => http.Response('', 403)));
    await tester.runAsync(() async {
      await tester.pumpWidget(BundleenApp(model: vm));
      await Future<void>.delayed(const Duration(milliseconds: 20));
    });
    await tester.pumpAndSettle();
    expect(
      find.text('This account does not have access to this view.'),
      findsOneWidget,
    );
    expect(find.text('Refresh'), findsOneWidget);
    expect(find.text('Active requests'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    vm.dispose();
  });
  testWidgets('unconfigured build provides no sign-in action', (tester) async {
    await tester.pumpWidget(const BundleenApp());
    expect(
      find.textContaining('needs a configured environment'),
      findsOneWidget,
    );
    expect(find.byType(FilledButton), findsNothing);
  });
}
