import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  deliverPendingOutbox,
  enqueueUpcomingServiceReminders,
} from "@/lib/server/notifications";
import { reconcileExpiredWindows } from "@/lib/server/neighborhood-market";

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
    // Deadlines are advanced before reminders are queued, so a request whose
    // bidding window closed this minute is already `bidding_closed` when the
    // manager reads their notification. Every step is a conditional update, so
    // a manager clicking the same button concurrently changes zero rows rather
    // than transitioning twice.
    const reconciled = await reconcileExpiredWindows();
    const remindersQueued = await enqueueUpcomingServiceReminders();
    const result = await deliverPendingOutbox(100);
    return NextResponse.json({ ...result, remindersQueued, reconciled });
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
