import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
// Separate from the bid suite: no .env fallback, migrations, or remote targets.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("Explicit disposable issue10 TEST_DATABASE_URL required.");
let parsed: URL;
try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL."); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !/^bundleen_issue10_test(?:_[a-z0-9_-]+)?$/i.test(parsed.pathname.slice(1))) throw new Error("Refusing non-disposable issue10 PostgreSQL target.");
const root = resolve(import.meta.dirname, "../..");
export default defineConfig({ resolve: { alias: { "@": resolve(root, "src"), "server-only": resolve(root, "tests/stubs/server-only.ts"), "next/server": resolve(root, "node_modules/next/server.js") } }, test: { environment: "node", include: ["tests/postgres/owner-request.postgres.ts"], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
