import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// No dotenv loading or fallback to application credentials is permitted.
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Set TEST_DATABASE_URL to the disposable loopback bundleen_issue1_test database.");
let target: URL;
try { target = new URL(raw); } catch { throw new Error("Invalid TEST_DATABASE_URL."); }
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/bundleen_issue1_test' || target.search || target.hash) {
  throw new Error("Postgres verification requires the exact disposable loopback bundleen_issue1_test database without URL options.");
}
process.env.DATABASE_URL = raw;
delete process.env.DIRECT_URL;
process.env.RATE_LIMIT_IDENTIFIER_SECRET = "local-postgres-verification-only";

export default defineConfig({
  resolve: { alias: {
    "@": resolve(import.meta.dirname, "../../src"),
    "next/server": resolve(import.meta.dirname, "../../node_modules/next/server.js"),
    "server-only": resolve(import.meta.dirname, "../stubs/server-only.ts"),
  } },
  test: {
    environment: "node",
    include: ["tests/postgres/**/*.postgres.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
