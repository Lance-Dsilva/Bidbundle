import type {
  AgreementSummary,
  BidSummary,
  HoaRequestStatusValue,
  OccurrenceSummary,
  VisitSummary,
} from "@/lib/hoa-types";

/**
 * Wire types for the non-HOA neighbourhood marketplace.
 *
 * These describe the same persisted rows the HOA workflow uses — one request
 * model, one bid model, one agreement, one visit — viewed through the
 * neighbourhood's own permissions. Nothing here is a second marketplace; it is
 * the shape a homeowner, a joined participant, and the neighbourhood manager
 * are each allowed to see.
 */

/** What the signed-in account may do with one neighbourhood request. */
export type NeighborhoodRequestPermissions = {
  /** May join or decline right now (enrollment open, active member). */
  canRespond: boolean;
  /** May run the lifecycle: open/close bidding, award. */
  canManage: boolean;
  /** May see bid comparisons and participant counts. */
  canViewBids: boolean;
  /** May edit or cancel — creator, pre-bidding only. */
  canEdit: boolean;
};

export type NeighborhoodParticipant = {
  userId: string;
  displayName: string;
  /** Whether Bundleen holds a routeable address for this home. */
  addressReady: boolean;
  response: "joined" | "declined";
  isViewer: boolean;
};

export type NeighborhoodRequestView = {
  id: string;
  communityId: string;
  communityName: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  status: HoaRequestStatusValue;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  minHomes: number;
  maxHomes: number | null;
  enrollmentClosesAt: string | null;
  biddingClosesAt: string | null;
  participantsLockedAt: string | null;
  awardedAt: string | null;
  startDate: string | null;
  joinedCount: number;
  declinedCount: number;
  bidCount: number;
  /** The viewer's own answer, or null if they have not answered. */
  viewerResponse: "joined" | "declined" | null;
  isOwner: boolean;
  createdByName: string;
  createdAt: string;
  permissions: NeighborhoodRequestPermissions;
  /**
   * Present only for the manager and joined participants. Ordered cheapest
   * first, and never returned to a neighbour who is not taking part.
   */
  bids: BidSummary[] | null;
  /** Present only for the manager. Names, not addresses. */
  participants: NeighborhoodParticipant[] | null;
  agreement: AgreementSummary | null;
  /** The viewer's own stops. A participant never sees another home's stop. */
  myVisits: VisitSummary[];
  /**
   * Group-level progress the manager may see: counts by status, with no
   * private location or access note attached.
   */
  occurrences: OccurrenceSummary[] | null;
};

/** The homeowner's neighbourhood page: their own requests plus neighbours'. */
export type NeighborhoodHub = {
  communityId: string;
  communityName: string;
  /** True when the viewer is this neighbourhood's assigned manager. */
  isManager: boolean;
  managerName: string | null;
  activeNeighbourCount: number;
  /** Whether Bundleen holds a routeable address for the viewer's own home. */
  addressReady: boolean;
  requests: NeighborhoodRequestView[];
};

/** Structured refusal when an award would leave homes unrouteable. */
export type MissingAddressReport = {
  count: number;
  /** Display names only — never another resident's address. */
  names: string[];
};
