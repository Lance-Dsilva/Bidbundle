import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/ai/scope";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z.object({}).strict();
type Input = z.infer<typeof inputSchema>;

export const getAdminOperationsSummary: ToolDefinition<Input> = {
  name: "get_admin_operations_summary",
  description:
    "Bundleen-admin-only. High-level operational counts across all communities: active communities, service requests by status, bids by status, and providers pending verification. Takes no arguments.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  inputSchema,
  async run(scope) {
    requireAdmin(scope, "get_admin_operations_summary");

    const [activeCommunities, requestsByStatus, bidsByStatus, providersPendingVerification] =
      await Promise.all([
        db.community.count({ where: { status: "active" } }),
        db.hoaServiceRequest.groupBy({ by: ["status"], _count: { _all: true } }),
        db.serviceBid.groupBy({ by: ["status"], _count: { _all: true } }),
        db.providerProfile.count({ where: { accountStatus: "pending" } }),
      ]);

    return {
      data: {
        activeCommunities,
        requestsByStatus: Object.fromEntries(
          requestsByStatus.map((row) => [row.status, row._count._all]),
        ),
        bidsByStatus: Object.fromEntries(bidsByStatus.map((row) => [row.status, row._count._all])),
        providersPendingVerification,
      },
      sources: [{ type: "data", label: "Bundleen operations summary", href: "/app/admin/dashboard" }],
    };
  },
};
