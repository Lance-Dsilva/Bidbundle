import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * One Prisma client per process.
 *
 * Next.js hot reload re-evaluates modules on every edit, which would otherwise
 * open a new connection pool each time until the database refuses connections.
 * Caching on `globalThis` survives module re-evaluation; production creates the
 * client exactly once so nothing is cached there.
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
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
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
