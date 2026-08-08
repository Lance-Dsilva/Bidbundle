import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not read Next.js env files, so load them here in the
// same precedence Next.js uses. Values already in the environment win, which
// keeps CI and `vercel env`-injected variables authoritative.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Prisma 7 removed the schema-level `directUrl` property, so the direct
 * (non-pooled) connection is wired up here instead: the CLI — `migrate`,
 * `db push`, `studio` — talks to `DIRECT_URL` when the provider supplies one,
 * while the running application uses the pooled `DATABASE_URL` through the
 * `@prisma/adapter-pg` driver adapter in `src/lib/server/db.ts`.
 *
 * Poolers such as PgBouncer in transaction mode cannot run the advisory locks
 * and DDL that migrations need, which is why the two URLs stay separate.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
