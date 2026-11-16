import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Explicit disposable identity only. Never load .env or reuse application URLs.
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Set an explicit disposable issue43 TEST_DATABASE_URL.");
let target: URL;
try { target = new URL(raw); } catch { throw new Error("Invalid disposable issue43 PostgreSQL URL."); }
if (!["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" || target.port !== "53952" ||
    !/^bundleen_issue43_test(?:_[a-z0-9_-]+)?$/.test(target.pathname.slice(1)) ||
    !/^bundleen_issue43_runner_[a-z0-9]+$/.test(target.username) || !target.password ||
    target.search || target.hash) {
  throw new Error("Issue52 tests require the explicitly owned 127.0.0.1:53952 synthetic database and role.");
}
process.env.DATABASE_URL = raw;
delete process.env.DIRECT_URL;
process.env.RATE_LIMIT_IDENTIFIER_SECRET = "issue43-isolated-database-only";
process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN = "issue43-isolated-private-transport-only";

export default defineConfig({
  resolve: { alias: {
    "@": resolve(import.meta.dirname, "../../src"),
    "server-only": resolve(import.meta.dirname, "../stubs/server-only.ts"),
    "next/server": resolve(import.meta.dirname, "../../node_modules/next/server.js"),
  } },
  test: {
    environment: "node",
    include: ["tests/postgres/pool-template.postgres.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
