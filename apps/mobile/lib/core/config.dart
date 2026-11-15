import 'package:flutter/services.dart' show appFlavor;

class AppConfig {
  AppConfig({
    required this.environment,
    required String apiOrigin,
    required this.publishableKey,
  }) : origin = Uri.parse(apiOrigin) {
    if (!{'development', 'staging', 'production'}.contains(environment) ||
        origin.scheme != 'https' ||
        origin.host.isEmpty ||
        origin.userInfo.isNotEmpty ||
        origin.hasQuery ||
        origin.hasFragment ||
        (origin.path.isNotEmpty && origin.path != '/') ||
        !publishableKey.startsWith(
          environment == 'production' ? 'pk_live_' : 'pk_test_',
        )) {
      throw const FormatException('Invalid mobile environment configuration');
    }
  }
  final String environment;
  final Uri origin;
  final String publishableKey;

  /// Testable boundary used by the real entry point before native auth/network setup.
  factory AppConfig.forFlavor({
    required String? flavor,
    required String environment,
    required String apiOrigin,
    required String publishableKey,
  }) {
    if (!{'development', 'staging'}.contains(flavor) || flavor != environment) {
      throw const FormatException(
        'Mobile flavor does not match its environment',
      );
    }
    return AppConfig(
      environment: environment,
      apiOrigin: apiOrigin,
      publishableKey: publishableKey,
    );
  }
  factory AppConfig.fromEnvironment() => AppConfig.forFlavor(
    flavor: appFlavor,
    environment: const String.fromEnvironment('BUNDLEEN_ENV'),
    apiOrigin: const String.fromEnvironment('BUNDLEEN_API_ORIGIN'),
    publishableKey: const String.fromEnvironment('CLERK_PUBLISHABLE_KEY'),
  );
}
