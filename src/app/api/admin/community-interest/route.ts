import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/admin-api";
import { listCommunityInterest } from "@/lib/server/community-interest";
import { communityInterestListQuerySchema } from "@/lib/validation/community-interest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Uses the same live administrator grant gate as existing CRM customer reads. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return noStore(gate.response);
    const params = new URL(request.url).searchParams;
    const query = communityInterestListQuerySchema.safeParse(Object.fromEntries(params));
    if (!query.success || [...params.keys()].some((key) => params.getAll(key).length !== 1)) {
      return noStore(NextResponse.json({ error: "Choose a valid page and page size." }, { status: 400 }));
    }
    return noStore(NextResponse.json(await listCommunityInterest(query.data)));
  } catch {
    return noStore(NextResponse.json({ error: "We could not load community interest. Please try again." }, { status: 503 }));
  }
}
