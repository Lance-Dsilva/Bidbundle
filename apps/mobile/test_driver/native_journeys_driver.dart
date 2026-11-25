import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final output = Directory(
    Platform.environment['BUNDLEEN_FIXTURE_EVIDENCE'] ??
        'build/fixture-evidence',
  );
  await output.create(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      if (!RegExp(r'^synthetic-[a-z0-9-]+$').hasMatch(name)) return false;
      await File('${output.path}/$name.png').writeAsBytes(bytes);
      return true;
    },
  );
}
