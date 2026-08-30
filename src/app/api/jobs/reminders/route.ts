import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { deliverPendingOutbox } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The high-frequency outbox worker.
 *
 * Separate from `/api/jobs/outbox` for one reason: cadence. The amenity
 * booking reminder promises delivery about 30 minutes before a reservation
 * starts, and a once-daily recovery job cannot keep that promise. This
 * endpoint does only the drain — no deadline reconciliation, no 24-hour
 * service-visit sweep — so it is cheap enough to run every few minutes.
 *
 * Delivery is claim-based and idempotent (`deliverPendingOutbox` claims each
 * event with a conditional `updateMany`), so overlapping invocations are safe
 * and no reminder can be sent twice.
 *
 * ── Deployment note ──────────────────────────────────────────────────────
 *
 * `vercel.json` schedules this every five minutes, which is the tightest
 * cadence Vercel Cron offers on the Hobby/Pro plans and is inside the promised
 * window: a reminder due at T-30 goes out between T-30 and T-25. If a tighter
 * window is ever promised, point an external scheduler (QStash, EventBridge,
 * or a container cron) at this same URL with `OUTBOX_WORKER_SECRET` — nothing
 * in the code needs to change.
 */
function matches(secret: string | undefined, header: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const provided = Buffer.from(header);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function isAuthorizedWorker(request: Request): boolean {
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-outbox-secret") ??
    "";
  return (
    matches(process.env.CRON_SECRET, header) ||
    matches(process.env.OUTBOX_WORKER_SECRET, header)
  );
}

async function drain(request: Request): Promise<NextResponse> {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await deliverPendingOutbox(100);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[reminders] drain failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Reminder drain failed." }, { status: 500 });
  }
}

export function GET(request: Request): Promise<NextResponse> {
  return drain(request);
}

export function POST(request: Request): Promise<NextResponse> {
  return drain(request);
}
