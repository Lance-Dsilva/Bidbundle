import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { hasRouteableHomeAddress } from "@/lib/home-address";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { buildPreferenceAwareNotificationOps } from "@/lib/server/notifications";
import {
  CATEGORY_LABELS,
  type CreateHomeownerRequestInput,
  type ServiceCategory,
} from "@/lib/validation/homeowner-requests";

/**
 * Individual (non-HOA) homeowner service requests.
 *
 * One request model, not two. These rows live in `HoaServiceRequest` — the
 * table the marketplace already builds bids, agreements, and visits on — and
 * the HOA/non-HOA distinction is read from `Community.type`. A second table
 * would split "my requests" across two sources and leave two feeds to keep in
 * step forever.
 *
 * The product rule this module makes explicit in code:
 *
 * - **HOA compulsory/recurring** services are created by the HOA manager, in
 *   the manager workspace. A resident never creates one, here or anywhere.
 * - **HOA optional/non-recurring** services follow the existing participation
 *   workflow: the manager opens them, residents join or decline on
 *   `/app/homeowner/community`. A resident does not open one individually.
 * - **A non-HOA homeowner** — someone placed in a `neighborhood` community —
 *   opens an individual request through this module, and it is never mixed
 *   with an HOA service request.
 *
 * Eligibility is resolved *before* the form is shown as well as on the write,
 * so a homeowner who cannot create a request is told what to do instead rather
 * than being handed a form that can only fail.
 */

export type HomeownerRequestBlockReason =
  /** Signed in as a provider or admin. */
  | "wrong_role"
  /** Lives in an HOA: services there run through the HOA manager. */
  | "hoa_resident"
  /** Placed in a neighborhood, but the membership is not active yet. */
  | "membership_pending"
  /** No community at all, because the profile has no usable home address. */
  | "no_profile_location"
  /** Address on file, but no neighborhood covers it yet. */
  | "no_community";

/** HTTP status for each product-state refusal. Never 404, never a bare 500. */
const BLOCK_STATUS: Record<HomeownerRequestBlockReason, number> = {
  wrong_role: 403,
  hoa_resident: 409,
  membership_pending: 409,
  no_profile_location: 409,
  no_community: 409,
};

export class HomeownerRequestError extends Error {
  readonly status: number;
  readonly reason: HomeownerRequestBlockReason | "invalid";

  constructor(
    message: string,
    status: number,
    reason: HomeownerRequestBlockReason | "invalid",
  ) {
    super(message);
    this.name = "HomeownerRequestError";
    this.status = status;
    this.reason = reason;
  }
}

export type HomeownerRequestEligibility =
  | {
      canCreate: true;
      communityId: string;
      communityName: string;
    }
  | {
      canCreate: false;
      reason: HomeownerRequestBlockReason;
      /** What is true, in the customer's terms. */
      message: string;
      /** The one thing they can usefully do next. */
      actionLabel: string;
      actionPath: string;
    };

/**
 * Resolves what this account may do, from live membership rows only.
 *
 * Nothing here is read from the request body: the caller passes the session
 * user id and gets back the server's own answer.
 */
export async function getRequestEligibility(user: {
  id: string;
  role: string;
}): Promise<HomeownerRequestEligibility> {
  if (user.role !== "homeowner") {
    return {
      canCreate: false,
      reason: "wrong_role",
      message:
        "Only homeowner accounts can open a service request. Providers bid on requests instead of raising them.",
      actionLabel: "Go to your dashboard",
      actionPath: user.role === "provider" ? "/app/provider/dashboard" : "/app/admin/dashboard",
    };
  }

  const memberships = await db.communityMembership.findMany({
    where: { userId: user.id, status: { in: ["active", "pending"] } },
    select: {
      status: true,
      community: { select: { id: true, name: true, type: true, status: true } },
    },
  });

  const live = memberships.filter((row) => row.community.status === "active");

  // An HOA resident is blocked first and unconditionally. Living in an HOA is
  // the stronger fact: services there are procured for the whole community by
  // the manager, so an individual request would bypass the process the
  // community actually runs on.
  if (live.some((row) => row.community.type === "hoa" && row.status === "active")) {
    return {
      canCreate: false,
      reason: "hoa_resident",
      message:
        "Your home is in an HOA, so services are arranged by your HOA manager. Compulsory services are scheduled for you, and you can join optional ones from your community page.",
      actionLabel: "Open your community",
      actionPath: "/app/homeowner/community",
    };
  }

  const neighborhood = live.filter((row) => row.community.type === "neighborhood");
  const active = neighborhood.find((row) => row.status === "active");
  if (!active && neighborhood.length > 0) {
    return {
      canCreate: false,
      reason: "membership_pending",
      message:
        "Your neighbourhood membership is still being reviewed. You will be able to open requests as soon as it is approved.",
      actionLabel: "Check your community",
      actionPath: "/app/homeowner/community",
    };
  }

  // Creating a request auto-enrolls its owner, so an existing membership must
  // not bypass the same routeable-address requirement as an explicit join.
  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: { address: true, latitude: true, longitude: true },
  });
  const hasLocation = hasRouteableHomeAddress(profile);
  if (active) {
    return hasLocation
      ? {
          canCreate: true,
          communityId: active.community.id,
          communityName: active.community.name,
        }
      : {
          canCreate: false,
          reason: "no_profile_location",
          message: "Add and confirm your home address before opening a request so the provider can reach your home.",
          actionLabel: "Add your address",
          actionPath: "/app/homeowner/profile",
        };
  }

  return hasLocation
    ? {
        canCreate: false,
        reason: "no_community",
        message:
          "Bundleen has not opened a neighbourhood covering your address yet. We will place you automatically as soon as one is live.",
        actionLabel: "Review your address",
        actionPath: "/app/homeowner/profile",
      }
    : {
        canCreate: false,
        reason: "no_profile_location",
        message:
          "Add your home address to your profile so Bundleen can place you in a neighbourhood. Requests are matched to nearby neighbours and providers by location.",
        actionLabel: "Add your address",
        actionPath: "/app/homeowner/profile",
      };
}

/* ── Serialization ───────────────────────────────────────────────────────── */

export type HomeownerRequestView = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  /** Whole US cents. Null on requests created before budgets existed. */
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  status: string;
  /** Which workflow this request belongs to. Derived, never client-supplied. */
  context: "neighborhood" | "hoa";
  communityId: string;
  communityName: string;
  bidCount: number;
  /** Lowest live bid in cents, or null when nobody has bid yet. */
  bestBidCents: number | null;
  enrollmentClosesAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const requestSelect = {
  id: true,
  title: true,
  category: true,
  description: true,
  budgetMinCents: true,
  budgetMaxCents: true,
  status: true,
  enrollmentClosesAt: true,
  createdAt: true,
  updatedAt: true,
  community: { select: { id: true, name: true, type: true } },
  _count: { select: { bids: true } },
  // Cheapest live bid. `take: 1` on an ordered relation read, so the figure is
  // the real lowest quote rather than a number computed in the browser.
  bids: {
    where: { status: { in: ["submitted", "accepted"] } },
    orderBy: { amountCents: "asc" },
    take: 1,
    select: { amountCents: true },
  },
} satisfies Prisma.HoaServiceRequestSelect;

type RequestRow = Prisma.HoaServiceRequestGetPayload<{ select: typeof requestSelect }>;

function serialize(row: RequestRow): HomeownerRequestView {
  const category = row.category as ServiceCategory;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[category] ?? row.category,
    description: row.description,
    budgetMinCents: row.budgetMinCents,
    budgetMaxCents: row.budgetMaxCents,
    status: row.status,
    context: row.community.type === "hoa" ? "hoa" : "neighborhood",
    communityId: row.community.id,
    communityName: row.community.name,
    bidCount: row._count.bids,
    bestBidCents: row.bids[0]?.amountCents ?? null,
    enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

/**
 * "My Requests": the requests this account actually owns.
 *
 * Ownership is in the `where`, so there is no parameter here that can widen it
 * to somebody else's requests. HOA community services are deliberately absent —
 * a resident does not own those, and they are shown on the community page.
 */
export async function listHomeownerRequests(
  ownerUserId: string,
): Promise<HomeownerRequestView[]> {
  const rows = await db.hoaServiceRequest.findMany({
    where: { createdByUserId: ownerUserId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: requestSelect,
  });
  return rows.map(serialize);
}

/* ── Write ───────────────────────────────────────────────────────────────── */

/** The neighbourhood group window: how long neighbours have to join. */
const ENROLLMENT_WINDOW_MS = 72 * 3_600_000;

/**
 * The floor an individual request needs before it can go out for bids.
 *
 * One, on purpose. A homeowner who wants their driveway pressure washed has a
 * real job whether or not a neighbour joins; requiring two homes would leave
 * them stuck at `collecting_interest` forever. A request that genuinely needs
 * several homes to be worth quoting sets a higher `minHomes` explicitly.
 */
const DEFAULT_MIN_HOMES = 1;

/**
 * How long two identical submissions from the same account are treated as one,
 * so a double-click or a retried request cannot produce two requests.
 */
const DUPLICATE_SUBMISSION_WINDOW_MS = 120_000;

async function findRecentDuplicate(
  ownerUserId: string,
  input: CreateHomeownerRequestInput,
): Promise<string | null> {
  const existing = await db.hoaServiceRequest.findFirst({
    where: {
      createdByUserId: ownerUserId,
      title: input.title,
      category: input.category,
      description: input.description,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return existing?.id ?? null;
}

/**
 * Creates one individual homeowner request.
 *
 * Owner, community, kind, and status are all derived here. The input carries
 * only the description of the work; anything the browser might say about who
 * owns the request or where it goes is not read, because
 * `createHomeownerRequestSchema` is `.strict()` and never parses those keys in
 * the first place.
 */
export async function createHomeownerRequest(
  user: { id: string; role: string },
  input: CreateHomeownerRequestInput,
): Promise<HomeownerRequestView> {
  const eligibility = await getRequestEligibility(user);
  if (!eligibility.canCreate) {
    throw new HomeownerRequestError(
      eligibility.message,
      BLOCK_STATUS[eligibility.reason],
      eligibility.reason,
    );
  }

  const duplicateId = await findRecentDuplicate(user.id, input);
  if (duplicateId) {
    const existing = await getHomeownerRequest(user.id, duplicateId);
    if (existing) return existing;
  }

  const requestId = randomUUID();
  const now = new Date();

  // Neighbours who will be told the request exists. They get the title and the
  // neighbourhood — never the requester's address, and never their own
  // distance from it.
  const neighbourIntents = await db.communityMembership
    .findMany({
      where: {
        communityId: eligibility.communityId,
        status: "active",
        NOT: { userId: user.id },
      },
      select: { user: { select: { id: true, email: true } } },
    })
    .then((rows) =>
      rows.map(({ user: neighbour }) => ({
        userId: neighbour.id,
        email: neighbour.email,
        kind: "request" as const,
        title: `${eligibility.communityName}: a neighbour opened a service request`,
        body: `“${input.title}” — join by the deadline to be included in the group quote.`,
        linkPath: "/app/homeowner/neighbourhood",
        dedupeKey: `neighbourhood-request-open:${requestId}:${neighbour.id}`,
      })),
    );

  await db.$transaction([
    db.hoaServiceRequest.create({
      data: {
        id: requestId,
        communityId: eligibility.communityId,
        createdByUserId: user.id,
        title: input.title,
        category: input.category,
        description: input.description,
        budgetMinCents: input.budgetMinCents,
        budgetMaxCents: input.budgetMaxCents,
        // An individual request is a one-off that neighbours may join — never a
        // compulsory recurring service, which only an HOA manager can create.
        kind: "optional_group",
        // Server-owned. `draft` is deliberately unreachable from the browser:
        // a submitted request is submitted.
        status: "collecting_interest",
        opensAt: now,
        enrollmentClosesAt: new Date(now.getTime() + ENROLLMENT_WINDOW_MS),
        recurrenceIntervalDays: null,
        totalOccurrences: 1,
        // One home is a complete job. The requester's own home is always
        // participating, so a request that nobody joins is still awardable —
        // waiting for neighbours is an opportunity, not a requirement.
        minHomes: DEFAULT_MIN_HOMES,
      },
    }),
    // The requester is joined automatically. Opening a request *is* saying you
    // want the work; making them click "join" afterwards would be a way to
    // end up with a request whose own author is not in it.
    db.hoaRequestParticipation.create({
      data: {
        id: randomUUID(),
        requestId,
        userId: user.id,
        // Deliberately no `unitId`: a neighbourhood participation targets the
        // homeowner and their own verified address, not an HOA unit.
        unitId: null,
        response: "joined",
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: user.id,
        action: "hoa_request_created",
        targetType: "hoa_request",
        targetId: requestId,
        communityId: eligibility.communityId,
        metadata: { context: "neighborhood", kind: "optional_group" },
      }),
    }),
    ...(await buildPreferenceAwareNotificationOps(neighbourIntents)),
  ]);

  const created = await getHomeownerRequest(user.id, requestId);
  if (!created) {
    throw new HomeownerRequestError(
      "Your request was saved but could not be displayed. Reload My Requests to see it.",
      500,
      "invalid",
    );
  }
  return created;
}

/** One owned request, or null. Ownership is in the `where`. */
export async function getHomeownerRequest(
  ownerUserId: string,
  requestId: string,
): Promise<HomeownerRequestView | null> {
  const row = await db.hoaServiceRequest.findFirst({
    where: { id: requestId, createdByUserId: ownerUserId },
    select: requestSelect,
  });
  return row ? serialize(row) : null;
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

export type HomeownerDashboardSummary = {
  /** True when this account has never opened a request. */
  cold_start: boolean;
  active_requests: number;
  active_bids: number;
  total_saved_cents: number;
};

/** Statuses in which a request is still working for the homeowner. */
const ACTIVE_REQUEST_STATUSES = [
  "collecting_interest",
  "open_for_bids",
  "bidding_closed",
  "awarded",
  "scheduled",
  "in_progress",
] as const;

/**
 * Real counters for the homeowner shell and dashboard.
 *
 * Every number is an aggregate over rows this account owns. `total_saved_cents`
 * is the only derived figure: for each awarded request, the difference between
 * the budget the homeowner set and what they actually agreed to pay — never a
 * placeholder, and never negative.
 */
export async function getHomeownerDashboard(
  ownerUserId: string,
): Promise<HomeownerDashboardSummary> {
  const [totalRequests, activeRequests, activeBids, awarded] =
    await Promise.all([
      db.hoaServiceRequest.count({ where: { createdByUserId: ownerUserId } }),
      db.hoaServiceRequest.count({
        where: {
          createdByUserId: ownerUserId,
          status: { in: [...ACTIVE_REQUEST_STATUSES] },
        },
      }),
      db.serviceBid.count({
        where: {
          status: "submitted",
          request: { createdByUserId: ownerUserId },
        },
      }),
      db.hoaServiceRequest.findMany({
        where: {
          createdByUserId: ownerUserId,
          budgetMaxCents: { not: null },
          agreement: { isNot: null },
        },
        select: {
          budgetMaxCents: true,
          agreement: { select: { amountCents: true } },
        },
      }),
    ]);

  const totalSavedCents = awarded.reduce((sum, row) => {
    const agreed = row.agreement?.amountCents;
    if (agreed == null || row.budgetMaxCents == null) return sum;
    return sum + Math.max(0, row.budgetMaxCents - agreed);
  }, 0);

  return {
    cold_start: totalRequests === 0,
    active_requests: activeRequests,
    active_bids: activeBids,
    total_saved_cents: totalSavedCents,
  };
}
