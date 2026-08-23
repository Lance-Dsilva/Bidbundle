import "server-only";

import { z } from "zod";

import { db } from "@/lib/server/db";
import { requireProvider } from "@/lib/server/ai/scope";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z.object({}).strict();
type Input = z.infer<typeof inputSchema>;

export const getProviderPipeline: ToolDefinition<Input> = {
  name: "get_provider_pipeline",
  description:
    "Provider-only. The caller's own recent bids, active agreements, upcoming visits, review average, and open requests they are eligible to bid on. Always scoped to the signed-in provider; takes no arguments.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  inputSchema,
  async run(scope) {
    requireProvider(scope, "get_provider_pipeline");
    const providerUserId = scope.userId;

    const [bids, agreements, visits, reviewSummary] = await Promise.all([
      db.serviceBid.findMany({
        where: { providerUserId },
        orderBy: { submittedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          amountCents: true,
          submittedAt: true,
          request: { select: { title: true, communityId: true, community: { select: { name: true } } } },
        },
      }),
      db.serviceAgreement.findMany({
        where: { providerUserId, status: "active" },
        take: 10,
        select: {
          id: true,
          amountCents: true,
          startDate: true,
          endDate: true,
          communityId: true,
          community: { select: { name: true } },
        },
      }),
      db.serviceVisit.findMany({
        where: {
          occurrence: { agreement: { providerUserId } },
          scheduledDate: { gte: new Date() },
        },
        orderBy: { scheduledDate: "asc" },
        take: 10,
        select: {
          id: true,
          scheduledDate: true,
          windowStart: true,
          windowEnd: true,
          status: true,
          unit: { select: { label: true } },
        },
      }),
      db.review.aggregate({
        where: { providerUserId, status: "published" },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    const relatedCommunityIds = Array.from(
      new Set([
        ...bids.map((bid) => bid.request.communityId),
        ...agreements.map((agreement) => agreement.communityId),
      ]),
    );

    // Deliberate simplification: "eligible" requests are open requests in
    // communities the provider already has a relationship with (a past bid),
    // not a full geo/postal-code coverage match — see docs/ai-assistant.md.
    const eligibleRequests = relatedCommunityIds.length
      ? await db.hoaServiceRequest.findMany({
          where: {
            communityId: { in: relatedCommunityIds },
            status: "open_for_bids",
            bids: { none: { providerUserId } },
          },
          take: 5,
          select: {
            id: true,
            title: true,
            category: true,
            biddingClosesAt: true,
            community: { select: { name: true } },
          },
        })
      : [];

    return {
      data: {
        recentBids: bids.map((bid) => ({
          id: bid.id,
          requestTitle: bid.request.title,
          communityName: bid.request.community.name,
          status: bid.status,
          amountCents: bid.amountCents,
          submittedAt: bid.submittedAt.toISOString(),
        })),
        activeAgreements: agreements.map((agreement) => ({
          id: agreement.id,
          communityName: agreement.community.name,
          amountCents: agreement.amountCents,
          startDate: agreement.startDate?.toISOString() ?? null,
          endDate: agreement.endDate?.toISOString() ?? null,
        })),
        upcomingVisits: visits.map((visit) => ({
          id: visit.id,
          unitLabel: visit.unit.label,
          scheduledDate: visit.scheduledDate?.toISOString() ?? null,
          windowStart: visit.windowStart,
          windowEnd: visit.windowEnd,
          status: visit.status,
        })),
        reviews: {
          averageRating: reviewSummary._avg.rating,
          count: reviewSummary._count._all,
        },
        eligibleOpenRequests: eligibleRequests.map((request) => ({
          id: request.id,
          title: request.title,
          category: request.category,
          communityName: request.community.name,
          biddingClosesAt: request.biddingClosesAt?.toISOString() ?? null,
        })),
      },
      sources: [
        { type: "data", label: "Your bids", href: "/app/provider/bids" },
        { type: "data", label: "Your schedule", href: "/app/provider/schedule" },
        { type: "data", label: "Job feed", href: "/app/provider/job-feed" },
      ],
    };
  },
};
