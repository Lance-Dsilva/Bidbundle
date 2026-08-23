import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The project's tsconfig sets `"jsx": "preserve"` for Next's own SWC
  // pipeline; component tests need their own JSX transform, which this
  // plugin provides independently of that.
  plugins: [react()],
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
    // Component tests (.test.tsx) opt into a DOM with a `// @vitest-environment
    // jsdom` comment at the top of the file; everything else is server/pure
    // logic and stays on this default.
    environment: "node",
    setupFiles: ["tests/stubs/dom-setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Integration suites hit a real database and a real Upstash quota, so they
    // are opt-in via `npm run test:integration`.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
