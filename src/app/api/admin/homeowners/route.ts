import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { listHomeownerCandidates } from "@/lib/server/communities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const communityId = (url.searchParams.get("communityId") ?? "").trim().slice(0, 64);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  if (!communityId) {
    return NextResponse.json({ error: "Choose a community." }, { status: 400 });
  }
  if (search.length < 2) return NextResponse.json({ candidates: [] });

  try {
    return NextResponse.json({
      candidates: await listHomeownerCandidates(communityId, search),
    });
  } catch (error) {
    return adminErrorResponse("homeowner candidates", error);
  }
}
