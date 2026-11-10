#!/usr/bin/env bash
set -eu

case "${VERCEL_ENV:-}" in
  preview|development)
    # Compile without the migration step in the production package build script.
    exec ./node_modules/.bin/next build
    ;;
  production)
    if [ "${VERIFY_PRIVATE_VISIT_STORAGE:-}" = "1" ]; then
      node --conditions=react-server scripts/verify-visit-photo-storage.mjs
    fi
    exec npm run build
    ;;
  *)
    printf '%s\n' 'Build refused: VERCEL_ENV must be preview, development, or production.' >&2
    exit 1
    ;;
esac
