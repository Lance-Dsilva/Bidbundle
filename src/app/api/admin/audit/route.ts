import { NextResponse } from "next/server";

import type { AuditListResult } from "@/lib/community-types";
import { serializeAuditEntry } from "@/lib/server/audit";
import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import { auditListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads the append-only admin audit log.
 *
 * There is no POST, PATCH, or DELETE here and there never will be: entries are
 * written by the services that make the changes they describe, in the same
 * transaction, and a database trigger rejects any attempt to edit one
 * afterwards.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const url = new URL(request.url);
    const query = auditListQuerySchema.parse(searchParamsToObject(url.searchParams));

    const where = {
      ...(query.communityId ? { communityId: query.communityId } : {}),
      ...(query.providerUserId ? { providerUserId: query.providerUserId } : {}),
    };

    const [total, rows] = await Promise.all([
      db.adminAuditLog.count({ where }),
      db.adminAuditLog.findMany({
        where,
        select: auditSelect,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const result: AuditListResult = {
      entries: rows.map((row) => serializeAuditEntry(row, toPersonSummary)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };

    return NextResponse.json(result);
  } catch (error) {
    return adminErrorResponse("audit list", error);
  }
}
