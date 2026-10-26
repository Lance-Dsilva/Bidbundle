#!/usr/bin/env bash
# Run from any working directory. Safe for both setup and cache maintenance.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

command -v node >/dev/null || { echo "Node.js is required; select Node 22 in the cloud environment." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!((major === 22 && minor >= 13) || major === 24)) {
    console.error("Use Node 22.13+ (22.x) or Node 24.x; .nvmrc selects Node 22.");
    process.exit(1);
  }
'

# Include development tools even if the host exports NODE_ENV=production.
# postinstall generates Prisma's platform-specific client. It does not migrate.
# Do not copy credentials into the checkout or run seeds/migrations here.
npm ci --include=dev --include=optional --no-audit --no-fund

echo "Dependencies and Prisma client are ready. Run npm test, npm run lint, and npm run typecheck."
echo "Use npm run build:check for a build without database migrations."
