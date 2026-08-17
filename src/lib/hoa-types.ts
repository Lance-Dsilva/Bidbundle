export type HoaRequestStatusValue =
  | "draft"
  | "collecting_interest"
  | "open_for_bids"
  | "bidding_closed"
  | "awarded"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type HoaOnboardingStatusValue =
  | "draft"
  | "manager_invited"
  | "manager_active"
  | "residents_inviting"
  | "live"
  | "archived";

export type UnitOccupancyValue = "vacant" | "invite_pending" | "occupied" | "inactive";

export type BidStatusValue =
  | "draft"
  | "submitted"
  | "withdrawn"
  | "accepted"
  | "rejected"
  | "expired";

export type VisitStatusValue =
  | "unscheduled"
  | "scheduled"
  | "en_route"
  | "in_progress"
  | "completed"
  | "skipped"
  | "blocked"
  | "cancelled";

export type HoaInvitationSummary = {
  id: string;
  email: string;
  role: "hoa_manager" | "homeowner";
  status: "pending" | "accepted" | "revoked";
  unitId: string | null;
  unitLabel: string | null;
  invitedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
};

export type HoaProfileSummary = {
  communityId: string;
  legalName: string;
  displayName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  totalHomes: number;
  referenceCode: string | null;
  serviceNotes: string | null;
  onboardingStatus: HoaOnboardingStatusValue;
};

export type UnitSummary = {
  id: string;
  label: string;
  addressLine1: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  occupancyStatus: UnitOccupancyValue;
  accessNotes: string | null;
  residentName: string | null;
  residentEmail: string | null;
  pendingInviteEmail: string | null;
};

export type UnitImportPreviewRow = {
  line: number;
  label: string;
  status: "create" | "duplicate_in_file" | "already_exists" | "invalid";
  problem: string | null;
};

export type UnitImportResult = {
  committed: boolean;
  totalRows: number;
  createCount: number;
  duplicateCount: number;
  invalidCount: number;
  rows: UnitImportPreviewRow[];
};

export type BidSummary = {
  id: string;
  requestId: string;
  providerUserId: string;
  providerName: string;
  providerCompany: string | null;
  providerVerified: boolean;
  status: BidStatusValue;
  amountCents: number;
  currency: string;
  pricingBasis: "total" | "per_home" | "per_visit";
  perHomeCents: number | null;
  proposedStartDate: string | null;
  estimatedDurationLabel: string | null;
  scope: string;
  exclusions: string | null;
  cadenceLabel: string | null;
  validUntil: string | null;
  version: number;
  submittedAt: string;
};

export type HoaRequestSummary = {
  id: string;
  communityId: string;
  title: string;
  category: string;
  description: string;
  kind: "compulsory_recurring" | "optional_group";
  recurrenceLabel: string | null;
  recurrenceIntervalDays: number | null;
  totalOccurrences: number;
  status: HoaRequestStatusValue;
  opensAt: string | null;
  enrollmentClosesAt: string | null;
  biddingClosesAt: string | null;
  startDate: string | null;
  minHomes: number | null;
  maxHomes: number | null;
  participantsLockedAt: string | null;
  awardedAt: string | null;
  joinedCount: number;
  declinedCount: number;
  bidCount: number;
  viewerResponse: "joined" | "declined" | null;
  createdAt: string;
};

export type AgreementSummary = {
  id: string;
  requestId: string;
  requestTitle: string;
  communityId: string;
  communityName: string;
  providerUserId: string;
  providerName: string;
  providerCompany: string | null;
  amountCents: number;
  currency: string;
  pricingBasis: "total" | "per_home" | "per_visit";
  perHomeCents: number | null;
  scope: string;
  cadenceLabel: string | null;
  lockedHomeCount: number;
  startDate: string | null;
  endDate: string | null;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
};

export type VisitSummary = {
  id: string;
  occurrenceId: string;
  unitId: string;
  unitLabel: string;
  /** Present only for viewers authorized to see the stop location. */
  latitude: number | null;
  longitude: number | null;
  addressLine1: string | null;
  stopRank: number | null;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  estimatedMinutes: number | null;
  status: VisitStatusValue;
  completionNote: string | null;
  completedAt: string | null;
};

export type OccurrenceSummary = {
  id: string;
  agreementId: string;
  sequence: number;
  serviceDate: string;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  schedulePublishedAt: string | null;
  visits: VisitSummary[];
};

export type HoaSurveySummary = {
  id: string;
  communityId: string;
  monthKey: string;
  question: string;
  options: string[];
  status: "draft" | "open" | "closed";
  closesAt: string | null;
  voteCounts: number[];
  viewerOptionIndex: number | null;
  createdAt: string;
};

export type ReviewSummary = {
  id: string;
  reviewerName: string;
  rating: number;
  comment: string;
  subject: "visit" | "agreement";
  createdAt: string;
};

export type NotificationSummary = {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ServiceAreaSummary = {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  postalCodes: string[];
  status: "active" | "removed";
};

/* ── Manager portal ──────────────────────────────────────────────────────── */

export type HoaManagerCommunity = {
  id: string;
  name: string;
  profile: HoaProfileSummary | null;
  activeMemberCount: number;
  units: UnitSummary[];
  invitations: HoaInvitationSummary[];
  requests: HoaRequestSummary[];
  bidsByRequest: Record<string, BidSummary[]>;
  agreements: AgreementSummary[];
  occurrencesByAgreement: Record<string, OccurrenceSummary[]>;
  surveys: HoaSurveySummary[];
};

export type HoaManagerDashboard = {
  communities: HoaManagerCommunity[];
};

/* ── Resident portal ─────────────────────────────────────────────────────── */

export type ResidentHoaCommunity = {
  id: string;
  name: string;
  unitId: string | null;
  unitLabel: string | null;
  requests: HoaRequestSummary[];
  bidsByRequest: Record<string, BidSummary[]>;
  agreements: AgreementSummary[];
  /** Only the viewer's own unit visits plus safe community-level progress. */
  myVisits: VisitSummary[];
  surveys: HoaSurveySummary[];
};

export type ResidentHoaHub = {
  communities: ResidentHoaCommunity[];
};

/* ── Provider portal ─────────────────────────────────────────────────────── */

export type ProviderFeedItem = {
  requestId: string;
  communityName: string;
  locality: string | null;
  region: string | null;
  title: string;
  category: string;
  kind: "compulsory_recurring" | "optional_group";
  description: string;
  recurrenceLabel: string | null;
  totalOccurrences: number;
  homeCount: number;
  startDate: string | null;
  biddingClosesAt: string | null;
  myBid: BidSummary | null;
};

export type ProviderHoaWorkspace = {
  eligible: boolean;
  ineligibleReason: string | null;
  serviceAreas: ServiceAreaSummary[];
  categories: string[];
  feed: ProviderFeedItem[];
  bids: BidSummary[];
  agreements: AgreementSummary[];
  occurrencesByAgreement: Record<string, OccurrenceSummary[]>;
};
