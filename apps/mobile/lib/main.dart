import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'core/api.dart';
import 'core/auth.dart';
import 'core/config.dart';
import 'features/home/home_model.dart';
import 'features/home/models.dart';
import 'features/home/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  HomeModel? model;
  try {
    final config = AppConfig.fromEnvironment();
    final auth = NativeAuthSession();
    model = HomeModel(
      config,
      auth,
      HomeRepository(ApiClient(config, auth, http.Client())),
    );
  } on FormatException {
    /* Fail closed without contacting any environment. */
  }
  runApp(BundleenApp(model: model));
}

class BundleenApp extends StatelessWidget {
  const BundleenApp({super.key, this.model});
  final HomeModel? model;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Bundleen',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xfff8f6ef),
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff087666),
        primary: const Color(0xff087666),
        onSurface: const Color(0xff193e34),
        surface: const Color(0xfff8f6ef),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(48, 52)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 52)),
      ),
    ),
    home: model == null
        ? const Scaffold(
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'Bundleen\n\nThis build needs a configured environment before sign-in is available.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
          )
        : HomeScreen(model: model!),
  );
}
