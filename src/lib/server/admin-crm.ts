import "server-only";

import { db } from "@/lib/server/db";

export type CrmHoaAccount = {
  id: string;
  name: string;
  locality: string | null;
  region: string | null;
  onboardingStatus:
    | "draft"
    | "manager_invited"
    | "manager_active"
    | "residents_inviting"
    | "live"
    | "archived";
  totalHomes: number;
  unitCount: number;
  activeMembers: number;
  pendingInvites: number;
  manager: { name: string; email: string } | null;
  openRequests: number;
  submittedBids: number;
  activeAgreements: number;
  updatedAt: Date;
};

export type AdminCrmOverview = {
  accounts: CrmHoaAccount[];
  onboarding: Record<CrmHoaAccount["onboardingStatus"], number>;
  customers: {
    householdCapacity: number;
    activeHouseholds: number;
    unassignedHoa: number;
  };
  operations: {
    activeRequests: number;
    submittedBids: number;
    activeAgreements: number;
    activeVisits: number;
  };
};

const activeRequestStatuses = [
  "collecting_interest",
  "open_for_bids",
  "bidding_closed",
  "awarded",
  "scheduled",
  "in_progress",
] as const;

/**
 * Admin CRM read model. It intentionally summarizes operational records rather
 * than inventing sales figures: every number can be traced to a persisted HOA,
 * invitation, request, bid, agreement, or visit.
 */
export async function getAdminCrmOverview(): Promise<AdminCrmOverview> {
  const [rawAccounts, onboardingRows, hoaWithoutProfile, householdCapacity, activeHouseholds, unassignedHoa, activeRequests, submittedBids, activeAgreements, activeVisits] =
    await Promise.all([
      db.community.findMany({
        where: { type: "hoa", status: "active" },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          id: true,
          name: true,
          updatedAt: true,
          hoaProfile: {
            select: {
              onboardingStatus: true,
              totalHomes: true,
              locality: true,
              region: true,
            },
          },
          _count: {
            select: {
              units: true,
              memberships: { where: { status: "active" } },
              invitations: {
                where: {
                  status: "pending",
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              },
            },
          },
          staffAssignments: {
            where: { role: "hoa_manager", status: "active" },
            orderBy: { assignedAt: "asc" },
            take: 1,
            select: {
              user: { select: { fullName: true, email: true } },
            },
          },
          hoaRequests: {
            where: { status: { in: [...activeRequestStatuses] } },
            select: {
              _count: { select: { bids: { where: { status: "submitted" } } } },
            },
          },
          serviceAgreements: {
            where: { status: "active" },
            select: { id: true },
          },
        },
      }),
      db.hoaProfile.groupBy({
        by: ["onboardingStatus"],
        where: { community: { type: "hoa", status: "active" } },
        _count: { _all: true },
      }),
      db.community.count({
        where: { type: "hoa", status: "active", hoaProfile: null },
      }),
      db.hoaProfile.aggregate({
        where: { community: { type: "hoa", status: "active" } },
        _sum: { totalHomes: true },
      }),
      db.communityMembership.count({
        where: { status: "active", community: { type: "hoa", status: "active" } },
      }),
      db.community.count({
        where: {
          type: "hoa",
          status: "active",
          staffAssignments: { none: { role: "hoa_manager", status: "active" } },
        },
      }),
      db.hoaServiceRequest.count({ where: { status: { in: [...activeRequestStatuses] } } }),
      db.serviceBid.count({ where: { status: "submitted" } }),
      db.serviceAgreement.count({ where: { status: "active" } }),
      db.serviceVisit.count({
        where: { status: { in: ["scheduled", "en_route", "in_progress"] } },
      }),
    ]);

  const onboarding: AdminCrmOverview["onboarding"] = {
    draft: hoaWithoutProfile,
    manager_invited: 0,
    manager_active: 0,
    residents_inviting: 0,
    live: 0,
    archived: 0,
  };
  for (const row of onboardingRows) onboarding[row.onboardingStatus] = row._count._all;

  return {
    accounts: rawAccounts.map((community) => ({
      id: community.id,
      name: community.name,
      locality: community.hoaProfile?.locality ?? null,
      region: community.hoaProfile?.region ?? null,
      onboardingStatus: community.hoaProfile?.onboardingStatus ?? "draft",
      totalHomes: community.hoaProfile?.totalHomes ?? 0,
      unitCount: community._count.units,
      activeMembers: community._count.memberships,
      pendingInvites: community._count.invitations,
      manager: community.staffAssignments[0]
        ? {
            name: community.staffAssignments[0].user.fullName,
            email: community.staffAssignments[0].user.email,
          }
        : null,
      openRequests: community.hoaRequests.length,
      submittedBids: community.hoaRequests.reduce((sum, request) => sum + request._count.bids, 0),
      activeAgreements: community.serviceAgreements.length,
      updatedAt: community.updatedAt,
    })),
    onboarding,
    customers: {
      householdCapacity: householdCapacity._sum.totalHomes ?? 0,
      activeHouseholds,
      unassignedHoa,
    },
    operations: { activeRequests, submittedBids, activeAgreements, activeVisits },
  };
}
