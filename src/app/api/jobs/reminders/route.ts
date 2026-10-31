import { timingSafeEqual } from "node:crypto";

import { Receiver } from "@upstash/qstash";
import { NextResponse } from "next/server";

import { reconcileNeighborhoodEnrollments } from "@/lib/server/neighborhood-market";
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
 * endpoint also reconciles elapsed enrollment windows in a bounded batch, so
 * neighborhood bidding starts promptly. The daily job retains the service-visit sweep.
 *
 * Delivery is claim-based and idempotent (`deliverPendingOutbox` claims each
 * event with a conditional `updateMany`), so overlapping invocations are safe
 * and no reminder can be sent twice.
 *
 * ── Deployment note ──────────────────────────────────────────────────────
 *
 * QStash schedules this every five minutes, which is inside the promised
 * window: a reminder due at T-30 goes out between T-30 and T-25. QStash signs
 * the raw request body; both the current and next signing keys are retained so
 * key rotation does not interrupt delivery. `OUTBOX_WORKER_SECRET` remains a
 * manual recovery credential rather than the primary scheduler identity.
 */
function matches(secret: string | undefined, header: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const provided = Buffer.from(header);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function isAuthorizedSharedSecretWorker(request: Request): boolean {
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-outbox-secret") ??
    "";
  return (
    matches(process.env.CRON_SECRET, header) ||
    matches(process.env.OUTBOX_WORKER_SECRET, header)
  );
}

async function hasValidQStashSignature(request: Request): Promise<boolean> {
  const signature = request.headers.get("upstash-signature");
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!signature || !currentSigningKey || !nextSigningKey) {
    return false;
  }

  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({
      signature,
      body: await request.clone().text(),
      clockTolerance: 5,
      upstashRegion: request.headers.get("upstash-region") ?? undefined,
    });
  } catch (error) {
    console.warn("[reminders] rejected QStash signature", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

async function drain(): Promise<NextResponse> {
  try {
    const reconciled = await reconcileNeighborhoodEnrollments();
    const result = await deliverPendingOutbox(100);
    return NextResponse.json({ ...result, reconciled });
  } catch (error) {
    console.error("[reminders] drain failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Reminder drain failed." }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedSharedSecretWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return drain();
}

export async function POST(request: Request): Promise<NextResponse> {
  const hasQStashSignature = request.headers.has("upstash-signature");
  const authorized = hasQStashSignature
    ? await hasValidQStashSignature(request)
    : isAuthorizedSharedSecretWorker(request);

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return drain();
}
