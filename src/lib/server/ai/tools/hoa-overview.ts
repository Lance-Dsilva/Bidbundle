import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { communityHref, resolveCommunityAccess } from "@/lib/server/ai/scope";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z
  .object({ communityId: z.string().trim().min(1).max(64) })
  .strict();
type Input = z.infer<typeof inputSchema>;

export const getHoaOverview: ToolDefinition<Input> = {
  name: "get_hoa_overview",
  description:
    "Overview of one HOA/neighborhood community the caller has access to: unit count, active resident count, and open service requests by status. Requires the community's id.",
  parameters: {
    type: "object",
    properties: {
      communityId: { type: "string", description: "The Bundleen community id." },
    },
    required: ["communityId"],
    additionalProperties: false,
  },
  inputSchema,
  async run(scope, input) {
    const access = await resolveCommunityAccess(scope, input.communityId);

    const [unitCount, activeMemberCount, requestsByStatus] = await Promise.all([
      db.communityUnit.count({ where: { communityId: access.communityId } }),
      db.communityMembership.count({
        where: { communityId: access.communityId, status: "active" },
      }),
      db.hoaServiceRequest.groupBy({
        by: ["status"],
        where: { communityId: access.communityId },
        _count: { _all: true },
      }),
    ]);

    return {
      data: {
        communityId: access.communityId,
        name: access.name,
        unitCount,
        activeMemberCount,
        requestsByStatus: Object.fromEntries(
          requestsByStatus.map((row) => [row.status, row._count._all]),
        ),
      },
      sources: [
        {
          type: "data",
          label: access.name,
          href: communityHref(scope.role, access.isManagerOrAdmin, access.communityId),
        },
      ],
    };
  },
};
