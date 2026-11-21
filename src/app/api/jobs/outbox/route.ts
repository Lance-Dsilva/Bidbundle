import { generateHoaMonthlyStatements } from "@/lib/server/hoa-revenue-share";
import { reconcileQualityResolutions } from "@/lib/server/service-quality-resolution";
import { reconcileStripeTestRefunds } from "@/lib/server/stripe-test-refunds";
import { reconcileStripeTestPayments } from "@/lib/server/stripe-test-reconciliation";
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  deliverPendingOutbox,
  enqueueUpcomingServiceReminders,
} from "@/lib/server/notifications";
import { reconcileExpiredWindows } from "@/lib/server/neighborhood-market";
import { sweepProviderCredentialExpirations } from "@/lib/server/provider-credential-expiry";

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
    const credentials = await sweepProviderCredentialExpirations();
    const result = await deliverPendingOutbox(100);
    // Sandbox failures must not turn successful unrelated notification delivery into a failed job.
    let stripeTest: Awaited<ReturnType<typeof reconcileStripeTestPayments>> | null = null;
    try { stripeTest = await reconcileStripeTestPayments(); } catch { stripeTest = { processed: 0, refreshed: 0, failed: 1 }; }
    let stripeRefundsFailed = false;
    try { await reconcileStripeTestRefunds(); } catch { stripeRefundsFailed = true; }
    let qualityResolutionsFailed = false;
    try { await reconcileQualityResolutions(); } catch { qualityResolutionsFailed = true; }
    let hoaStatements: Awaited<ReturnType<typeof generateHoaMonthlyStatements>> | null = null;
    let hoaStatementsFailed = false;
    try { hoaStatements = await generateHoaMonthlyStatements(); hoaStatementsFailed = hoaStatements.failed > 0; } catch { hoaStatementsFailed = true; }
    return NextResponse.json({ hoaStatements, hoaStatementsFailed, qualityResolutionsFailed, ...result, remindersQueued, reconciled, credentials, stripeTest, stripeRefundsFailed });
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
