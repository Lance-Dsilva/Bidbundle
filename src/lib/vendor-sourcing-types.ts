import type { ServiceCategory } from "@/lib/service-categories";
import type { PoolTemplate, PoolTierCounts } from "@/lib/pool-bid-template";

export const VENDOR_LEAD_SOURCES = ["cslb", "hoa_referral", "resident_referral", "admin", "self_signup"] as const;
export const VENDOR_LEAD_STATUSES = ["new", "invited", "engaged", "signed_up", "declined", "unsubscribed", "bounced"] as const;
export type VendorLeadSource = typeof VENDOR_LEAD_SOURCES[number];
export type VendorLeadStatus = typeof VENDOR_LEAD_STATUSES[number];

/** Internal admin/referrer data; never the public invitation payload. */
export type AdminVendorLead = {
  id: string; businessName: string; categories: ServiceCategory[];
  licenseNumber: string | null; licenseClasses: string[]; licenseStatus: string; licenseJurisdiction: string;
  licenseExpiresAt: string | null; workersCompOnFile: boolean | null; bondOnFile: boolean | null;
  phone: string | null; email: string | null; website: string | null;
  city: string | null; region: string | null; postalCode: string | null; county: string | null;
  latitude: number | null; longitude: number | null;
  source: VendorLeadSource; status: VendorLeadStatus; contactConfirmed: boolean;
  convertedProviderUserId: string | null; lastInvitedAt: string | null; notes: string | null;
};
export type VendorRequestSummary = {
  id: string; category: string; areaLabel: string; homeCount: number; biddingClosesAt: string;
  poolTemplate: PoolTemplate | null; tierCounts: PoolTierCounts; requiresAfterPhoto: boolean;
};
export type VendorSourcingView = {
  request: VendorRequestSummary;
  registered: Array<{ providerUserId: string; name: string; verified: boolean; approved: boolean; distanceMi: number | null; invited: boolean }>;
  leads: Array<AdminVendorLead & { distanceMi: number | null; eligible: boolean; exclusionReason: string | null }>;
  funnel: { invited: number; opened: number; proposalStarted: number; submitted: number };
  outreach: { ready: boolean; missing: string[] };
};
export type PublicVendorBidSummary = {
  request: VendorRequestSummary;
  invitation: { expiresAt: string; claimed: boolean; submitted: boolean };
  prefill: { businessName: string; licenseNumber: string | null; licenseState: string; categories: string[] };
};
