import { NextResponse } from "next/server";

import { hoaErrorResponse, requireProviderUser } from "@/lib/server/hoa-api";
import { getProviderEarnings } from "@/lib/server/marketplace-reads";

/**
 * This provider's earnings, from agreements they actually won.
 *
 * Replaces the old `/provider/earnings` call, which had no Route Handler.
 * Figures come from the snapshotted agreement terms, so a later bid edit
 * cannot change what a completed job was worth.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ earnings: await getProviderEarnings(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("provider earnings", error);
  }
}
