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
  factory AppConfig.fromEnvironment() => AppConfig(
    environment: const String.fromEnvironment('BUNDLEEN_ENV'),
    apiOrigin: const String.fromEnvironment('BUNDLEEN_API_ORIGIN'),
    publishableKey: const String.fromEnvironment('CLERK_PUBLISHABLE_KEY'),
  );
}
