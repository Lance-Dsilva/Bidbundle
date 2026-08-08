import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "next/server": resolve(import.meta.dirname, "./node_modules/next/server.js"),
      // Server modules are marked `import "server-only"`, which throws outside
      // a React Server Component. Tests exercise them directly, so the guard
      // is stubbed out here rather than removed from the source.
      "server-only": resolve(import.meta.dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites hit a real database and a real Upstash quota, so they
    // are opt-in via `npm run test:integration`.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
