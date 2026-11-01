// Tests the real Dart bridge over a fake binary messenger. This does not
// exercise Clerk SDKs, secure storage, a browser, devices, or live identities.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/core/auth.dart';
import 'package:bundleen/features/home/home_model.dart';
import 'package:bundleen/features/home/models.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as fixtures;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('bundleen/auth');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late NativeAuthSession auth;

  HomeModel createModel(http.Client client) => HomeModel(
    fixtures.config(),
    auth,
    HomeRepository(ApiClient(fixtures.config(), auth, client)),
  );
  void handler(Future<Object?> Function(MethodCall) callback) =>
      messenger.setMockMethodCallHandler(channel, callback);

  setUp(() {
    auth = NativeAuthSession();
  });
  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
  });

  for (final signUp in [false, true]) {
    test(
      'native ${signUp ? 'signup' : 'signin'} cancellation stays signed out and retry recovers',
      () async {
        var cancel = true;
        var requests = 0;
        handler((call) async {
          switch (call.method) {
            case 'initialize':
              expect(call.arguments, {
                'publishableKey': fixtures.config().publishableKey,
              });
              return false;
            case 'signIn':
            case 'signUp':
              expect(
                call.method,
                signUp ? 'signUp' : 'signIn',
                reason: 'User intent must select the correct native authentication mode on both attempts',
              );
              if (cancel) {
                throw PlatformException(
                  code: 'cancelled',
                  message: 'private native details',
                );
              }
              return null;
            case 'getToken':
              return 'recovered-token';
            default:
              throw StateError('Unexpected native call');
          }
        });
        final vm = createModel(
          MockClient((request) async {
            requests++;
            return fixtures.route(request);
          }),
        );
        addTearDown(vm.dispose);
        await vm.initialize();
        await vm.authenticate(createAccount: signUp);
        expect(vm.status, HomeStatus.signedOut);
        expect(vm.signedIn, isFalse);
        expect(vm.data, isNull);
        expect(vm.message, 'Sign-in cancelled.');
        expect(requests, 0);
        cancel = false;
        await vm.authenticate(createAccount: signUp);
        expect(vm.status, HomeStatus.ready);
        expect(vm.data?.profile.id, 'u1');
        expect(vm.message, isNull);
        expect(requests, 3);
      },
    );
  }

  test('native failure differs from cancellation, hides details and permits recovery', () async {
    var failed = true;
    handler((call) async {
      if (call.method == 'initialize') return false;
      if (call.method == 'getToken') return 'valid-token';
      if (failed) {
        throw PlatformException(
          code: 'auth_failed',
          message: 'sensitive-provider-detail',
        );
      }
      return null;
    });
    final vm = createModel(
      MockClient((request) async => fixtures.route(request)),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.authenticate();
    expect(vm.message, 'Sign-in could not be completed. Please try again.');
    expect(vm.message, isNot(contains('sensitive')));
    expect(vm.signedIn, isFalse);
    failed = false;
    await vm.authenticate();
    expect(vm.status, HomeStatus.ready);
  });

  for (final replacementAccepted in [true, false]) {
    test(
      '401 uses actual replacement token and ${replacementAccepted ? 'succeeds' : 'stops after second rejection'}',
      () async {
        final refreshes = <bool>[];
        final sentTokens = <String?>[];
        handler((call) async {
          expect(call.method, 'getToken');
          final forced = (call.arguments as Map)['forceRefresh'] as bool;
          refreshes.add(forced);
          return forced ? 'replacement-token' : 'expired-token';
        });
        final api = ApiClient(
          fixtures.config(),
          auth,
          MockClient((request) async {
            sentTokens.add(request.headers['Authorization']);
            if (request.headers['Authorization'] ==
                    'Bearer replacement-token' &&
                replacementAccepted) {
              return fixtures.jsonResponse({'id': 'verified-profile'});
            }
            return http.Response('', 401);
          }),
        );
        if (replacementAccepted) {
          expect(await api.get('/api/profile'), {'id': 'verified-profile'});
        } else {
          await expectLater(
            api.get('/api/profile'),
            throwsA(fixtures.failure(FailureKind.unauthenticated)),
          );
        }
        expect(refreshes, [false, true]);
        expect(sentTokens, [
          'Bearer expired-token',
          'Bearer replacement-token',
        ]);
      },
    );
  }

  test('native signout error clears view, blocks reauthentication, then retry recovers', () async {
    var failLogout = true;
    var signIns = 0;
    var signOuts = 0;
    handler((call) async {
      switch (call.method) {
        case 'initialize':
          return true;
        case 'getToken':
          return 'active-token';
        case 'signIn':
          signIns++;
          return null;
        case 'signOut':
          signOuts++;
          if (failLogout) throw PlatformException(code: 'offline');
          return null;
        default:
          throw StateError('Unexpected native call');
      }
    });
    final vm = createModel(
      MockClient((request) async => fixtures.route(request)),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    expect(vm.data, isNotNull);
    await vm.signOut();
    expect(vm.data, isNull);
    expect(vm.signedIn, isFalse);
    expect(vm.logoutPending, isTrue);
    await vm.authenticate();
    expect(signIns, 0);
    failLogout = false;
    await vm.signOut();
    expect(signOuts, 2);
    expect(vm.logoutPending, isFalse);
    expect(vm.status, HomeStatus.signedOut);
    await vm.authenticate();
    expect(signIns, 1);
    expect(vm.status, HomeStatus.ready);
  });

  test(
    'late successful native signin cannot resurrect view after signout',
    () async {
      final completed = Completer<void>();
      final started = Completer<void>();
      var requests = 0;
      handler((call) async {
        if (call.method == 'initialize') return false;
        if (call.method == 'signIn') {
          started.complete();
          await completed.future;
        }
        return null;
      });
      final vm = createModel(
        MockClient((request) async {
          requests++;
          return fixtures.route(request);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      final authentication = vm.authenticate();
      await started.future;
      await vm.signOut();
      completed.complete();
      await authentication;
      expect(vm.status, HomeStatus.signedOut);
      expect(vm.signedIn, isFalse);
      expect(vm.data, isNull);
      expect(requests, 0);
    },
  );

  test(
    'late native initialization cannot restore session after signout',
    () async {
      final initialized = Completer<bool>();
      final started = Completer<void>();
      var requests = 0;
      handler((call) async {
        if (call.method == 'initialize') {
          started.complete();
          return initialized.future;
        }
        return null;
      });
      final vm = createModel(
        MockClient((request) async {
          requests++;
          return fixtures.route(request);
        }),
      );
      addTearDown(vm.dispose);
      final initializing = vm.initialize();
      await started.future;
      await vm.signOut();
      initialized.complete(true);
      await initializing;
      expect(vm.status, HomeStatus.signedOut);
      expect(vm.signedIn, isFalse);
      expect(vm.data, isNull);
      expect(requests, 0);
    },
  );
}
