#!/usr/bin/env bash
set -euo pipefail
# Run from apps/mobile. Synthetic values never reach native auth/network.
flutter_bin="${FLUTTER_BIN:-flutter}"
for flavor in development staging; do
  "$flutter_bin" test test/flavor_config_test.dart --flavor="$flavor" --dart-define="BUNDLEEN_ENV=$flavor" --dart-define=BUNDLEEN_API_ORIGIN=https://api.example.invalid --dart-define=CLERK_PUBLISHABLE_KEY=pk_test_fixture --dart-define=EXPECT_CONFIG_ACCEPT=true
 done
for pair in development:staging staging:development production:production absent:staging development:absent; do
 flavor="${pair%%:*}"; environment="${pair#*:}"
 args=()
 if [[ "$flavor" != absent ]]; then args+=(--flavor="$flavor"); fi
 if [[ "$environment" != absent ]]; then args+=(--dart-define="BUNDLEEN_ENV=$environment"); fi
 "$flutter_bin" test test/flavor_config_test.dart "${args[@]}" --dart-define=BUNDLEEN_API_ORIGIN=https://api.example.invalid --dart-define=CLERK_PUBLISHABLE_KEY=pk_test_fixture
 done
"$flutter_bin" test test/flavor_config_test.dart --flavor=staging --dart-define=BUNDLEEN_ENV=staging
