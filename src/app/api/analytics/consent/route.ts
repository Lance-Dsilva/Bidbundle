import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/auth";
import { guardHoaMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { readJsonBody } from "@/lib/server/profile";
import { db } from "@/lib/server/db";
import { ANALYTICS_CONSENT_VERSION } from "@/lib/analytics/events";
import { setProductAnalyticsConsent } from "@/lib/server/product-analytics";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const consentSchema = z.object({ allowed: z.boolean() }).strict();

export async function GET() {
  const gate = await authorizeRequest();
  if (!gate.ok) return gate.response;
  try {
    const consent = await db.productAnalyticsConsent.findUnique({ where: { userId: gate.user.id } });
    return NextResponse.json({ allowed: consent?.allowed === true && consent.version === ANALYTICS_CONSENT_VERSION, decided: consent?.version === ANALYTICS_CONSENT_VERSION }, { headers });
  } catch { return NextResponse.json({ error: "Unable to load analytics preference." }, { status: 503, headers }); }
}

export async function PUT(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const gate = await authorizeRequest();
  if (!gate.ok) return gate.response;
  const failure = await guardHoaMutation(gate.user.id);
  if (failure) return guardFailureResponse(failure);
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return body.response;
  const parsed = consentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Choose whether to allow analytics." }, { status: 400, headers });
  try {
    await setProductAnalyticsConsent(gate.user.id, parsed.data.allowed);
    return NextResponse.json({ allowed: parsed.data.allowed, decided: true }, { headers });
  } catch { return NextResponse.json({ error: "Unable to save analytics preference." }, { status: 503, headers }); }
}
