import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Exactly one Prisma client per process, in every environment.
 *
 * The single-instance rule is not only about connection count. Prisma's batch
 * `$transaction([...])` can only be atomic when every operation in the array
 * was built by the *same* client: the batch is dispatched through that client's
 * engine, so a promise created by a second client executes on its own
 * connection, outside the transaction. Handing a batch mixed clients therefore
 * runs the statements concurrently and independently — the parent row commits
 * while the child inserts race it and fail their foreign keys.
 *
 * That is precisely what an earlier version of this file caused: the proxy
 * below calls {@link getPrismaClient} on every property access, and the cache
 * was skipped when `NODE_ENV === "production"`, so `db.a`, `db.b` and
 * `db.$transaction` were three different clients in production only. The cache
 * is unconditional now; `globalThis` is still used on top of it so Next's dev
 * hot reload, which re-evaluates this module, does not leak a pool per edit.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  // Prefer the pooled URL for serverless traffic. A direct URL is also a
  // valid runtime connection and keeps profile setup working when a Vercel
  // environment was configured with only the migration credential.
  const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

  if (!connectionString) {
    throw new Error("Neither DATABASE_URL nor DIRECT_URL is set.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // `error` and `warn` only: `query` logs statement parameters, which would
    // put password hashes and email addresses into the server logs.
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrismaClient(): PrismaClient {
  return (globalForPrisma.prisma ??= createPrismaClient());
}

/**
 * The client is created on first property access rather than at import.
 *
 * `next build` imports every route to collect page data, and doing that with
 * no `DATABASE_URL` would otherwise fail the build — the connection string is
 * genuinely not needed until a query runs. Deferring also means a missing
 * variable surfaces as a handled request error instead of a dead process.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrismaClient(), property, receiver);
  },
});
