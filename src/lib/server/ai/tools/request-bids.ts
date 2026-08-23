import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { communityHref, resolveCommunityAccess } from "@/lib/server/ai/scope";
import { AiToolError } from "@/lib/server/ai/errors";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z.object({ requestId: z.string().trim().min(1).max(64) }).strict();
type Input = z.infer<typeof inputSchema>;

export const getRequestBids: ToolDefinition<Input> = {
  name: "get_request_bids",
  description:
    "Bids submitted on one service request. Homeowners, HOA managers, and admins with access to the request's community see all bids; a provider sees only their own bid on that request, never a competitor's amount.",
  parameters: {
    type: "object",
    properties: {
      requestId: { type: "string", description: "The Bundleen service request id." },
    },
    required: ["requestId"],
    additionalProperties: false,
  },
  inputSchema,
  async run(scope, input) {
    const request = await db.hoaServiceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, title: true, communityId: true },
    });
    if (!request) throw new AiToolError("That service request does not exist.", 404);

    if (scope.role === "provider") {
      const ownBid = await db.serviceBid.findUnique({
        where: { requestId_providerUserId: { requestId: request.id, providerUserId: scope.userId } },
        select: {
          id: true,
          status: true,
          amountCents: true,
          currency: true,
          pricingBasis: true,
          submittedAt: true,
        },
      });
      if (!ownBid) throw new AiToolError("You have no bid on that request.", 403);

      return {
        data: {
          requestId: request.id,
          title: request.title,
          bids: [
            {
              id: ownBid.id,
              status: ownBid.status,
              amountCents: ownBid.amountCents,
              currency: ownBid.currency,
              pricingBasis: ownBid.pricingBasis,
              submittedAt: ownBid.submittedAt.toISOString(),
              mine: true,
            },
          ],
        },
        sources: [{ type: "data", label: "Your bid", href: "/app/provider/bids" }],
      };
    }

    const access = await resolveCommunityAccess(scope, request.communityId);

    const bids = await db.serviceBid.findMany({
      where: { requestId: request.id, status: { in: ["submitted", "accepted", "rejected"] } },
      orderBy: [{ status: "asc" }, { amountCents: "asc" }],
      select: {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        pricingBasis: true,
        submittedAt: true,
        provider: { select: { fullName: true } },
      },
    });

    return {
      data: {
        requestId: request.id,
        title: request.title,
        bids: bids.map((bid) => ({
          id: bid.id,
          providerName: bid.provider.fullName,
          status: bid.status,
          amountCents: bid.amountCents,
          currency: bid.currency,
          pricingBasis: bid.pricingBasis,
          submittedAt: bid.submittedAt.toISOString(),
        })),
      },
      sources: [
        {
          type: "data",
          label: `Bids — ${request.title}`,
          href: communityHref(scope.role, access.isManagerOrAdmin, access.communityId, "requests"),
        },
      ],
    };
  },
};
