import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Explicit synthetic enrollment database required.");
const url = new URL(raw);
if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "53952" ||
    url.pathname !== "/bundleen_issue48_test_shared" ||
    !/^bundleen_issue43_runner_[a-z0-9]+$/.test(url.username) || !url.password || url.search || url.hash) {
  throw new Error("Refusing anything except the owned loopback synthetic enrollment database.");
}
process.env.DATABASE_URL = raw;
delete process.env.DIRECT_URL;
process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN = "synthetic-enrollment-transport-only";
process.env.RATE_LIMIT_IDENTIFIER_SECRET = "synthetic-enrollment-only";
export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "../../src"), "server-only": resolve(import.meta.dirname, "../stubs/server-only.ts"), "next/server": resolve(import.meta.dirname, "../../node_modules/next/server.js") } },
  test: { environment: "node", include: ["tests/postgres/shared-enrollment-independent.postgres.ts"], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 },
});
