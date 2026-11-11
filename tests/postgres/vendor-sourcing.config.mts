import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in disposable identity only. Do not load .env or application credentials.
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Set an explicit disposable issue59 TEST_DATABASE_URL.");
let target: URL;
try { target = new URL(raw); } catch { throw new Error("Invalid disposable issue59 PostgreSQL URL."); }
if (!["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" || target.port !== "54371" ||
    !/^bundleen_issue59_test_[a-z0-9]+$/.test(target.pathname.slice(1)) ||
    !/^bundleen_issue59_runner_[a-z0-9]+$/.test(target.username) || !target.password ||
    target.search || target.hash) {
  throw new Error("Issue59 tests require an explicitly owned 127.0.0.1:54371 synthetic database and role.");
}
process.env.DATABASE_URL = raw;
delete process.env.DIRECT_URL;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM_ADDRESS;
delete process.env.RESEND_EMAIL_DOMAIN;
delete process.env.CLERK_SECRET_KEY;
process.env.RATE_LIMIT_IDENTIFIER_SECRET = "issue59-isolated-database-only";

export default defineConfig({
  resolve: { alias: {
    "@": resolve(import.meta.dirname, "../../src"),
    "server-only": resolve(import.meta.dirname, "../stubs/server-only.ts"),
    "next/server": resolve(import.meta.dirname, "../../node_modules/next/server.js"),
  } },
  test: {
    environment: "node",
    include: ["tests/postgres/vendor-sourcing.postgres.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
