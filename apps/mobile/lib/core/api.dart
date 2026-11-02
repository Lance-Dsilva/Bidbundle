import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'auth.dart';
import 'config.dart';

enum FailureKind {
  unauthenticated,
  forbidden,
  profileIncomplete,
  notFound,
  rateLimited,
  network,
  server,
  invalidResponse,
}

class ApiFailure implements Exception {
  const ApiFailure(this.kind);
  final FailureKind kind;
  String get message => switch (kind) {
    FailureKind.unauthenticated =>
      'Your session has ended. Please sign in again.',
    FailureKind.forbidden => 'This account does not have access to this view.',
    FailureKind.profileIncomplete =>
      'Your Bundleen profile needs to be completed before continuing.',
    FailureKind.notFound => 'This information is no longer available.',
    FailureKind.rateLimited =>
      'Too many requests. Please wait before trying again.',
    FailureKind.network =>
      'We could not connect. Check your connection and try again.',
    FailureKind.server =>
      'Bundleen is temporarily unavailable. Please try again.',
    FailureKind.invalidResponse =>
      'We could not read this response. Please try again later.',
  };
}

class ApiClient {
  ApiClient(
    this.config,
    this.auth,
    this.client, {
    this.timeout = const Duration(seconds: 20),
  });
  final AppConfig config;
  final AuthSession auth;
  final http.Client client;
  final Duration timeout;
  static const maxResponseBytes = 1024 * 1024;
  Future<Map<String, dynamic>> get(String path) async {
    // Routes are code-owned relative API paths. Reject authority changes.
    final relative = Uri.parse(path);
    if (!path.startsWith('/api/') ||
        relative.hasAuthority ||
        relative.hasScheme ||
        relative.hasFragment) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    try {
      for (var attempt = 0; attempt < 2; attempt++) {
        final String? token;
        try {
          token = await auth.token(forceRefresh: attempt > 0).timeout(timeout);
        } catch (_) {
          // A server rejection followed by failed renewal cannot retain a
          // signed-in view, even when the native SDK returns a platform error.
          if (attempt > 0) throw const ApiFailure(FailureKind.unauthenticated);
          rethrow;
        }
        if (token == null || token.isEmpty) {
          throw const ApiFailure(FailureKind.unauthenticated);
        }
        final request = http.Request('GET', config.origin.resolveUri(relative))
          ..followRedirects = false
          ..headers.addAll({
            'Authorization': 'Bearer $token',
            'Accept': 'application/json',
          });
        final response = await _send(request);
        if (response.statusCode == 401 && attempt == 0) {
          await response.stream.listen(null).cancel();
          continue; // One fresh SDK token request, safe GET only.
        }
        if (response.statusCode != 200) {
          await response.stream.listen(null).cancel();
          throw ApiFailure(switch (response.statusCode) {
            401 => FailureKind.unauthenticated,
            403 => FailureKind.forbidden,
            409 => FailureKind.profileIncomplete,
            404 => FailureKind.notFound,
            429 => FailureKind.rateLimited,
            >= 500 => FailureKind.server,
            _ => FailureKind.invalidResponse,
          });
        }
        if (!(response.headers['content-type'] ?? '').toLowerCase().startsWith(
          'application/json',
        )) {
          await response.stream.listen(null).cancel();
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        final body = await _readBounded(response);
        final decoded = jsonDecode(utf8.decode(body));
        if (decoded is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return decoded;
      }
      throw const ApiFailure(FailureKind.unauthenticated);
    } on ApiFailure {
      rethrow;
    } on FormatException {
      throw const ApiFailure(FailureKind.invalidResponse);
    } on TimeoutException {
      throw const ApiFailure(FailureKind.network);
    } on http.ClientException {
      throw const ApiFailure(FailureKind.network);
    }
  }

  Future<http.StreamedResponse> _send(http.Request request) async {
    var expired = false;
    final pending = client.send(request).then((response) async {
      if (expired) await response.stream.listen(null).cancel();
      return response;
    });
    return pending.timeout(
      timeout,
      onTimeout: () {
        expired = true;
        throw TimeoutException('Request deadline exceeded');
      },
    );
  }

  Future<List<int>> _readBounded(http.StreamedResponse response) async {
    final bytes = <int>[];
    final iterator = StreamIterator(response.stream);
    final deadline = DateTime.now().add(timeout);
    try {
      while (true) {
        final remaining = deadline.difference(DateTime.now());
        if (remaining <= Duration.zero) {
          throw TimeoutException('Response deadline exceeded');
        }
        if (!await iterator.moveNext().timeout(remaining)) break;
        final chunk = iterator.current;
        if (bytes.length + chunk.length > maxResponseBytes) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        bytes.addAll(chunk);
      }
      return bytes;
    } finally {
      await iterator.cancel();
    }
  }
}
