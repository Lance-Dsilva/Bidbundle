import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { deliverPendingOutbox } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function matches(secret: string | undefined, header: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const provided = Buffer.from(header);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; a manual worker
 * may use `OUTBOX_WORKER_SECRET` instead. Either grants access; nothing else. */
function isAuthorizedWorker(request: Request): boolean {
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-outbox-secret") ??
    "";
  return matches(process.env.CRON_SECRET, header) || matches(process.env.OUTBOX_WORKER_SECRET, header);
}

async function drain(request: Request): Promise<NextResponse> {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await deliverPendingOutbox();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[outbox] drain failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Outbox drain failed." }, { status: 500 });
  }
}

/**
 * Outbox drain endpoint. Delivery is idempotent and claim-based, so
 * overlapping invocations are safe. GET serves Vercel Cron; POST serves any
 * other scheduled worker.
 */
export function GET(request: Request): Promise<NextResponse> {
  return drain(request);
}

export function POST(request: Request): Promise<NextResponse> {
  return drain(request);
}
