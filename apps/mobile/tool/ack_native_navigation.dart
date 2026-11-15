// Host-side, test-only VM-service acknowledgement. Sends no device input.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

Future<void> main(List<String> args) async {
  if (args.length != 2) {
    stderr.writeln(
      'Usage: dart tool/ack_native_navigation.dart LOOPBACK_VM_WEBSOCKET_URI RECEIPT',
    );
    exitCode = 2;
    return;
  }
  // Process-wide watchdog also bounds connection/cleanup and isolate enumeration.
  final watchdog = Timer(const Duration(seconds: 20), () {
    stderr.writeln('N04 acknowledgement failed: helper deadline exceeded.');
    exit(1);
  });
  try {
    await acknowledge(args);
  } catch (_) {
    // VM service URIs contain debug access tokens; never print exception text.
    stderr.writeln(
      'N04 acknowledgement failed. Check the local debug service and pending receipt.',
    );
    exitCode = 1;
  } finally {
    watchdog.cancel();
  }
}

Future<void> acknowledge(List<String> args) async {
  final uri = Uri.parse(args[0]);
  if (uri.scheme != 'ws' ||
      !{'127.0.0.1', 'localhost', '::1'}.contains(uri.host) ||
      uri.userInfo.isNotEmpty) {
    throw ArgumentError(
      'Only the task-owned local debug VM WebSocket is permitted',
    );
  }
  final socket = await WebSocket.connect(uri.toString())
      .timeout(const Duration(seconds: 10));
  final messages = StreamIterator<dynamic>(socket);
  var sequence = 0;
  Future<Map<String, dynamic>> rpc(
    String method, [
    Map<String, dynamic> params = const {},
  ]) async {
    final deadline = DateTime.now().add(const Duration(seconds: 10));
    final id = '${++sequence}';
    socket.add(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': id,
        'method': method,
        'params': params,
      }),
    );
    while (true) {
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) throw TimeoutException('RPC deadline');
      if (!await messages.moveNext().timeout(remaining)) break;
      final value =
          jsonDecode(messages.current as String) as Map<String, dynamic>;
      if (value['id'] != id) continue;
      if (value.containsKey('error')) throw StateError('VM rejected $method');
      return value['result'] as Map<String, dynamic>;
    }
    throw StateError('Debug VM disconnected');
  }

  try {
    final vm = await rpc('getVM');
    final matches = <String>[];
    for (final isolate in vm['isolates'] as List<dynamic>) {
      final id = isolate['id'] as String;
      final details = await rpc('getIsolate', {'isolateId': id});
      if ((details['extensionRPCs'] as List<dynamic>? ?? []).contains(
        'ext.bundleen.n04Input',
      )) {
        matches.add(id);
      }
    }
    if (matches.length != 1) {
      throw StateError('Expected exactly one test integration isolate');
    }
    final result = await rpc('ext.bundleen.n04Input', {
      'isolateId': matches.single,
      'receipt': args[1],
    });
    if (result['acknowledged'] != true) {
      throw StateError('Receipt was not accepted');
    }
    stdout.writeln(
      'N04 reviewer delivery acknowledged; app must still pass post-input assertions.',
    );
  } finally {
    try {
      await messages.cancel().timeout(const Duration(seconds: 1));
    } finally {
      await socket.close().timeout(const Duration(seconds: 1));
    }
  }
}
