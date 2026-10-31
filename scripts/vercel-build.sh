#!/usr/bin/env bash
set -eu

case "${VERCEL_ENV:-}" in
  preview|development)
    # Compile without the migration step in the production package build script.
    exec ./node_modules/.bin/next build
    ;;
  production)
    exec npm run build
    ;;
  *)
    printf '%s\n' 'Build refused: VERCEL_ENV must be preview, development, or production.' >&2
    exit 1
    ;;
esac
