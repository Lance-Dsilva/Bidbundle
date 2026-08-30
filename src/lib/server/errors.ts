import "server-only";

import { randomUUID } from "node:crypto";

/**
 * The bridge between a useless client-facing 500 and a diagnosable server log.
 *
 * The support ticket outage this module was written for was hard to trace for
 * one reason: the handler logged only `error.name`, so every failure in the
 * production log read `PrismaClientKnownRequestError` with no statement, no
 * constraint, and no stack. The cause was invisible while the customer was
 * being told to "try again".
 *
 * {@link logUnexpectedFailure} therefore logs the *complete* cause server-side
 * and returns a short reference the client can quote. The reference is random
 * per occurrence, so it identifies a log line and reveals nothing about the
 * account, the query, or the data involved.
 */

/** Short, quotable, non-guessable reference for one failure occurrence. */
export function newErrorReference(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

type PrismaLikeError = {
  code?: unknown;
  meta?: unknown;
  clientVersion?: unknown;
};

/**
 * Everything about a failure that is safe to keep and useful to read.
 *
 * Prisma puts the failing constraint and model in `meta`, which is exactly what
 * identifies a schema/migration problem, and never contains row values. The
 * message and stack are Prisma's own text: they name tables and constraints,
 * not customer data. Request bodies and session values are deliberately absent.
 */
function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { name: "NonErrorThrown", value: String(error).slice(0, 500) };
  }

  const prismaLike = error as unknown as PrismaLikeError;
  return {
    name: error.name,
    message: error.message.slice(0, 2_000),
    ...(prismaLike.code === undefined ? {} : { code: prismaLike.code }),
    ...(prismaLike.meta === undefined ? {} : { meta: prismaLike.meta }),
    ...(prismaLike.clientVersion === undefined
      ? {}
      : { clientVersion: prismaLike.clientVersion }),
    stack: error.stack?.split("\n").slice(0, 20).join("\n"),
    ...(error.cause === undefined ? {} : { cause: String(error.cause).slice(0, 500) }),
  };
}

/**
 * Logs the full cause under a fresh reference and returns that reference.
 *
 * Callers put the reference in the client response and nothing else: the
 * customer can quote it to support, and support can find the one log line that
 * explains it.
 */
export function logUnexpectedFailure(scope: string, error: unknown): string {
  const reference = newErrorReference();
  console.error(`[${scope}] unhandled failure`, { reference, ...describe(error) });
  return reference;
}
