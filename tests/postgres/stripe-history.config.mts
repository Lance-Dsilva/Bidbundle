import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Explicit synthetic history database required.");
const url = new URL(raw);
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "53952" ||
    url.pathname !== "/bundleen_issue43_test_integration" || !/^bundleen_issue43_runner_[a-z0-9]+$/.test(url.username) || !url.password || url.search || url.hash) throw new Error("Refusing non-owned history test database.");
process.env.DATABASE_URL = raw; delete process.env.DIRECT_URL; process.env.STRIPE_TEST_PAYMENTS = "1";
export default defineConfig({ resolve: { alias: { "@": resolve(import.meta.dirname, "../../src"), "server-only": resolve(import.meta.dirname, "../stubs/server-only.ts") } }, test: { environment: "node", include: ["tests/postgres/stripe-history.postgres.ts"], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
