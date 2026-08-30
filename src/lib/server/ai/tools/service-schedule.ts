import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { residentUnitIds, resolveCommunityAccess } from "@/lib/server/ai/scope";
import { AiToolError } from "@/lib/server/ai/errors";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z
  .object({
    communityId: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;

const visitSelect = {
  id: true,
  scheduledDate: true,
  windowStart: true,
  windowEnd: true,
  status: true,
  unit: { select: { label: true } },
  serviceLabel: true,
} as const;

function serializeVisit(visit: {
  id: string;
  scheduledDate: Date | null;
  windowStart: string | null;
  windowEnd: string | null;
  status: string;
  unit: { label: string } | null;
  serviceLabel?: string | null;
}) {
  return {
    id: visit.id,
    // A stop is an HOA unit or a neighbourhood home; both have a label.
    stopLabel: visit.unit?.label ?? visit.serviceLabel ?? "Home",
    scheduledDate: visit.scheduledDate?.toISOString() ?? null,
    windowStart: visit.windowStart,
    windowEnd: visit.windowEnd,
    status: visit.status,
  };
}

export const getServiceSchedule: ToolDefinition<Input> = {
  name: "get_service_schedule",
  description:
    "Upcoming scheduled service visits. Providers get their own upcoming visits (no `communityId` needed). Homeowners, HOA managers, and admins must pass `communityId`; homeowners who are not a manager of that community see only their own unit's visits.",
  parameters: {
    type: "object",
    properties: {
      communityId: {
        type: "string",
        description: "Required for homeowner/HOA manager/admin callers; ignored for providers.",
      },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "Max visits to return." },
    },
    additionalProperties: false,
  },
  inputSchema,
  async run(scope, input) {
    const now = new Date();

    if (scope.role === "provider") {
      const visits = await db.serviceVisit.findMany({
        where: {
          occurrence: { agreement: { providerUserId: scope.userId } },
          scheduledDate: { gte: now },
        },
        orderBy: { scheduledDate: "asc" },
        take: input.limit,
        select: visitSelect,
      });
      return {
        data: { visits: visits.map(serializeVisit) },
        sources: [{ type: "data", label: "Your schedule", href: "/app/provider/schedule" }],
      };
    }

    if (!input.communityId) {
      throw new AiToolError("communityId is required for this role.", 400);
    }

    const access = await resolveCommunityAccess(scope, input.communityId);
    // Two kinds of stop live in this table. A manager sees the community's
    // whole schedule; a resident sees only their own home, whether that home
    // is an HOA unit or their own neighbourhood address.
    const scopeFilter = access.isManagerOrAdmin
      ? {
          OR: [
            { unit: { communityId: access.communityId } },
            { occurrence: { agreement: { communityId: access.communityId } } },
          ],
        }
      : {
          OR: [
            {
              unit: {
                communityId: access.communityId,
                id: { in: await residentUnitIds(scope.userId, access.communityId) },
              },
            },
            {
              homeownerUserId: scope.userId,
              occurrence: { agreement: { communityId: access.communityId } },
            },
          ],
        };

    const visits = await db.serviceVisit.findMany({
      where: { ...scopeFilter, scheduledDate: { gte: now } },
      orderBy: { scheduledDate: "asc" },
      take: input.limit,
      select: visitSelect,
    });

    return {
      data: { communityId: access.communityId, visits: visits.map(serializeVisit) },
      sources: [
        {
          type: "data",
          label: `Schedule — ${access.name}`,
          href: access.isManagerOrAdmin ? "/app/hoa/dashboard" : "/app/homeowner/community",
        },
      ],
    };
  },
};
