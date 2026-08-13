import type { AppRole } from "@/lib/validation/auth";
import type {
  CommunityStaffRole,
  CommunityStatus,
  CommunityType,
  MembershipStatus,
  ProviderAccountStatus,
} from "@/lib/validation/community";

/**
 * Wire shapes for `/api/admin/**` and `/api/me/context`.
 *
 * Imported by both the route handlers and the portal screens, so a renamed
 * field fails to compile on both sides. Note what is *not* here: no member
 * street address, no latitude/longitude on any list row, no Clerk identifier.
 * The portal shows whether someone falls inside a radius, not where they live.
 */

/* ── People ──────────────────────────────────────────────────────────────── */

/** The safe projection of a person anywhere in the internal portal. */
export type AdminPersonSummary = {
  id: string;
  fullName: string;
  /** Derived server-side so every surface renders the same initials. */
  initials: string;
  email: string;
  role: AppRole;
  avatarUrl: string | null;
};

/** Identity safe to expose to another resident of the same community. */
export type CustomerPersonSummary = Pick<
  AdminPersonSummary,
  "id" | "fullName" | "initials" | "avatarUrl"
>;

/* ── Communities ─────────────────────────────────────────────────────────── */

export type CommunitySummary = {
  id: string;
  name: string;
  type: CommunityType;
  status: CommunityStatus;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  activeMemberCount: number;
  pendingMemberCount: number;
  /** The single active `neighborhood_manager` or `hoa_manager`, if any. */
  manager: CommunityStaffAssignmentSummary | null;
  hoaTeamCount: number;
  createdAt: string;
};

export type CommunityStaffAssignmentSummary = {
  id: string;
  role: CommunityStaffRole;
  /** Human label for `role`, resolved once on the server. */
  roleLabel: string;
  user: AdminPersonSummary;
  assignedAt: string;
  assignedBy: AdminPersonSummary | null;
  /** True when this person is also an active resident of the community. */
  isResidentMember: boolean;
};

export type CommunityMemberSummary = {
  membershipId: string;
  user: AdminPersonSummary;
  status: MembershipStatus;
  joinedAt: string | null;
  isPrimary: boolean;
  isAdminOverride: boolean;
  /**
   * Location eligibility, computed server-side. `distanceMi` is rounded to a
   * tenth of a mile: enough to judge a radius call, not enough to locate a
   * home. `null` means the member has no stored coordinates or the community
   * has no centre to measure from.
   */
  distanceMi: number | null;
  isWithinRadius: boolean | null;
  /** Scoped roles this member holds in *this* community. */
  staffRoles: CommunityStaffRole[];
};

export type CommunityDetail = {
  community: CommunitySummary;
  members: CommunityMemberSummary[];
  staff: CommunityStaffAssignmentSummary[];
};

/** A homeowner the portal may legitimately offer for a given assignment. */
export type StaffCandidate = AdminPersonSummary & {
  /** Present only for neighborhood managers, who must already be residents. */
  membershipStatus: MembershipStatus | null;
};

export type CommunityListResult = {
  communities: CommunitySummary[];
  total: number;
  page: number;
  pageSize: number;
};

/* ── Providers ───────────────────────────────────────────────────────────── */

export type ProviderSummary = {
  userId: string;
  user: AdminPersonSummary;
  companyName: string | null;
  trades: string[];
  /** Free-text service area the provider stated. Not a verified boundary. */
  serviceArea: string | null;
  accountStatus: ProviderAccountStatus;
  accountStatusUpdatedAt: string | null;
  isLicenseVerified: boolean;
  isInsuranceVerified: boolean;
  /** Optimistic-lock token for staff verification actions. */
  updatedAt: string;
  createdAt: string;
};

export type ProviderDetail = ProviderSummary & {
  bio: string | null;
  phone: string | null;
  /** What the provider claims. Displaying it as proof would be wrong. */
  licenseNumber: string | null;
  licenseState: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  /** Server-written timestamps and the staff account behind each. */
  licenseVerifiedAt: string | null;
  licenseVerifiedBy: AdminPersonSummary | null;
  insuranceVerifiedAt: string | null;
  insuranceVerifiedBy: AdminPersonSummary | null;
  accountStatusUpdatedBy: AdminPersonSummary | null;
  accountStatusNote: string | null;
  approvedCommunities: Array<Pick<CommunitySummary, "id" | "name" | "type">>;
  recentAudit: AuditEntry[];
};

export type ProviderListResult = {
  providers: ProviderSummary[];
  total: number;
  page: number;
  pageSize: number;
};

/* ── Audit ───────────────────────────────────────────────────────────────── */

export type AuditEntry = {
  id: string;
  action: string;
  /** Sentence describing the action, built server-side from the metadata. */
  summary: string;
  targetType: string;
  targetId: string;
  actor: AdminPersonSummary | null;
  communityId: string | null;
  communityName: string | null;
  providerUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditListResult = {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/* ── Overview ────────────────────────────────────────────────────────────── */

export type AdminOverview = {
  hoaCommunities: number;
  neighborhoodCommunities: number;
  archivedCommunities: number;
  communitiesWithoutManager: number;
  homeowners: number;
  activeMemberships: number;
  pendingMemberships: number;
  providersByStatus: Record<ProviderAccountStatus, number>;
  providersAwaitingVerification: number;
  recentAudit: AuditEntry[];
};

/* ── Viewer context (the top-right identity area) ────────────────────────── */

/** One scoped responsibility, as the customer's own dashboard sees it. */
export type ViewerAssignment = {
  communityId: string;
  communityName: string;
  communityType: CommunityType;
  role: CommunityStaffRole;
  roleLabel: string;
};

export type ViewerCommunity = {
  communityId: string;
  communityName: string;
  communityType: CommunityType;
  status: MembershipStatus;
  isPrimary: boolean;
};

/**
 * Everything the identity area renders, resolved from live database rows on
 * every request. Nothing here is readable from, or writable through, Clerk
 * metadata or local storage.
 */
export type ViewerContext = {
  userId: string;
  fullName: string;
  initials: string;
  email: string;
  avatarUrl: string | null;
  role: AppRole;
  /** The single label to show, e.g. `Neighborhood manager`. */
  roleLabel: string;
  /** Provider status, shown alongside the label. `null` for non-providers. */
  providerStatus: ProviderAccountStatus | null;
  /** Active scoped assignments, most privileged first. */
  assignments: ViewerAssignment[];
  /** Communities the viewer is a resident of. */
  communities: ViewerCommunity[];
  /** True when the homeowner dashboard should reveal management sections. */
  canManageCommunity: boolean;
};

/** Error body shared by every admin route. */
export type AdminErrorBody = {
  error: string;
  fields?: Record<string, string>;
};
