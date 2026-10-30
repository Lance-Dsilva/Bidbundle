import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// No dotenv loading, Redis substitution, migrations, or automatic fallback.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("Set TEST_DATABASE_URL explicitly for a disposable issue18 PostgreSQL database.");
let parsed: URL;
try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL."); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !/^bundleen_issue18_test(?:_[a-z0-9_-]+)?$/i.test(parsed.pathname.slice(1))) {
  throw new Error("PostgreSQL suite refuses this target: use a loopback disposable bundleen_issue18_test database.");
}
const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
  resolve: { alias: {
    "@": resolve(root, "src"),
    "server-only": resolve(root, "tests/stubs/server-only.ts"),
    "next/server": resolve(root, "node_modules/next/server.js"),
  } },
  test: {
    environment: "node",
    include: ["tests/postgres/bid-version-cas.postgres.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
