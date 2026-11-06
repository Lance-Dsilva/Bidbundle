import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../test/mobile_test.dart' as base;
import '../../test/account_test.dart' as account;
import '../../test/requests_test.dart' as requests;
import '../../test/neighborhood_test.dart' as community;
import '../../test/provider_test.dart' as provider;
import '../../test/opportunities_test.dart' as opportunities;
import '../../test/coverage_test.dart' as coverage;
import '../../test/inbox_test.dart' as inbox;

class DenyHttp extends HttpOverrides {
  DenyHttp(this.violations);
  final List<String> violations;
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    violations.add('real HttpClient');
    throw StateError('Real HTTP is forbidden in synthetic journeys');
  }
}

class JourneyAuth extends base.FakeAuth {
  JourneyAuth(this.violations) {
    active = true;
  }
  final List<String> violations;
  @override
  Future<void> signIn() async {
    violations.add('unexpected fixture signIn');
    throw StateError('No fixture sign-in journey');
  }

  @override
  Future<void> signUp() async {
    violations.add('unexpected fixture signUp');
    throw StateError('No fixture sign-up journey');
  }
}

class FixtureHarness {
  FixtureHarness(this.role) {
    client = MockClient((request) async {
      final route =
          request.url.path +
          (request.url.hasQuery ? '?${request.url.query}' : '');
      if (request.method != 'GET' ||
          request.url.origin != 'https://api.example.test' ||
          request.url.userInfo.isNotEmpty ||
          request.url.hasFragment ||
          !responses.containsKey(route)) {
        violations.add('unexpected service request');
        throw StateError('Unexpected fixture request');
      }
      audit.add(route);
      if (failOnce.remove(route)) {
        return http.Response(
          '{}',
          503,
          headers: {'content-type': 'application/json'},
        );
      }
      return base.jsonResponse(responses[route]!);
    });
  }
  final String role;
  late final auth = JourneyAuth(violations);
  final violations = <String>[];
  final audit = <String>[];
  final failOnce = <String>{};
  late final http.Client client;
  HttpOverrides? previous;
  Map<String, Object> get responses => {
    '/api/profile': account.accountProfile(role: role),
    '/api/me/context': base.context(role),
    if (role == 'homeowner') ...{
      '/api/homeowner/dashboard': base.dashboard(),
      '/api/homeowner/requests': requests.listBody(),
      '/api/homeowner/requests/r1': {'request': requests.detail()},
      '/api/homeowner/neighbourhood': {'hub': community.hub()},
      '/api/homeowner/inbox': {
        'threads': [inbox.thread()],
      },
      '/api/homeowner/inbox/t1?limit=50&offset=0': inbox.transcript(),
    } else ...{
      '/api/provider/overview': {'overview': provider.overview()},
      '/api/provider/marketplace': {'workspace': opportunities.workspace()},
      '/api/provider/service-areas': {
        'areas': [coverage.area()],
      },
    },
  };
  void install() {
    previous = HttpOverrides.current;
    HttpOverrides.global = DenyHttp(violations);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('bundleen/auth'), (
          call,
        ) async {
          violations.add('native auth channel');
          throw PlatformException(code: 'fixture_forbidden');
        });
  }

  void dispose() {
    HttpOverrides.global = previous;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('bundleen/auth'), null);
    client.close();
  }
}
