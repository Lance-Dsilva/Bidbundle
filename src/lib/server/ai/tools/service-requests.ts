import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { communityHref, rejectProvider, resolveCommunityAccess } from "@/lib/server/ai/scope";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const REQUEST_STATUSES = [
  "draft",
  "collecting_interest",
  "open_for_bids",
  "bidding_closed",
  "awarded",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;

const inputSchema = z
  .object({
    communityId: z.string().trim().min(1).max(64),
    status: z.enum(REQUEST_STATUSES).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;

export const getServiceRequests: ToolDefinition<Input> = {
  name: "get_service_requests",
  description:
    "Lists HOA service requests for one community the caller has access to, most recent first. Optionally filter by status. Returns at most `limit` (default 10, max 20) rows.",
  parameters: {
    type: "object",
    properties: {
      communityId: { type: "string", description: "The Bundleen community id." },
      status: { type: "string", enum: REQUEST_STATUSES, description: "Optional status filter." },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "Max rows to return." },
    },
    required: ["communityId"],
    additionalProperties: false,
  },
  inputSchema,
  async run(scope, input) {
    rejectProvider(scope, "get_service_requests");
    const access = await resolveCommunityAccess(scope, input.communityId);

    const rows = await db.hoaServiceRequest.findMany({
      where: {
        communityId: access.communityId,
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        title: true,
        category: true,
        kind: true,
        status: true,
        biddingClosesAt: true,
        startDate: true,
        createdAt: true,
      },
    });

    return {
      data: {
        communityId: access.communityId,
        requests: rows.map((row) => ({
          id: row.id,
          title: row.title,
          category: row.category,
          kind: row.kind,
          status: row.status,
          biddingClosesAt: row.biddingClosesAt?.toISOString() ?? null,
          startDate: row.startDate?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      sources: [
        {
          type: "data",
          label: `Service requests — ${access.name}`,
          href: communityHref(scope.role, access.isManagerOrAdmin, access.communityId, "requests"),
        },
      ],
    };
  },
};
