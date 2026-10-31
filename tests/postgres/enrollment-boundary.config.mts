import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Explicit disposable target only: no dotenv, migrations, or application fallback.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("Explicit disposable issue10 PostgreSQL URL required.");
let parsed: URL;
try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL URL."); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/bundleen_issue10_test" || parsed.search || parsed.hash) {
  throw new Error("Enrollment verification requires the exact disposable loopback issue10 database.");
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
    include: ["tests/postgres/enrollment-boundary.postgres.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
