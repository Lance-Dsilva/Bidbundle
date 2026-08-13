import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { listProviders } from "@/lib/server/providers-admin";
import { providerListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paged provider list, filterable by account status and verification state. */
export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const url = new URL(request.url);
    const query = providerListQuerySchema.parse(searchParamsToObject(url.searchParams));
    return NextResponse.json(await listProviders(query));
  } catch (error) {
    return adminErrorResponse("provider list", error);
  }
}
