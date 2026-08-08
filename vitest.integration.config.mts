import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Opt-in integration suite: `npm run test:integration`.
 *
 * Unlike `npm test`, this talks to a real Postgres and a real Upstash Redis,
 * so it consumes cloud quota and must never point at production. It is kept
 * out of the default run for exactly that reason.
 *
 * Required environment:
 *   TEST_DATABASE_URL         an isolated database — its tables are truncated
 *   UPSTASH_REDIS_REST_URL    development Upstash resource
 *   UPSTASH_REDIS_REST_TOKEN
 */
loadEnv({ path: ".env.test.local", quiet: true });
loadEnv({ path: ".env.local", quiet: true });

const requiredVariables = [
  "TEST_DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RATE_LIMIT_IDENTIFIER_SECRET",
] as const;
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

if (missingVariables.length > 0) {
  throw new Error(
    `Integration tests require configured non-production resources. Missing: ${missingVariables.join(
      ", ",
    )}. See tests/integration/README.md.`,
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "server-only": resolve(import.meta.dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Shared Redis buckets and shared tables cannot take parallel writers.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
