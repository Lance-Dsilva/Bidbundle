import type { PayoutStatus, Weekday } from "@/lib/validation/profile";
import type { AppRole } from "@/lib/validation/auth";

/**
 * The wire shapes of `/api/profile*`.
 *
 * Client and server both import these, so a field renamed on one side fails to
 * compile on the other. No Prisma type is exported to the browser — the models
 * carry columns (Blob paths, verification timestamps) the client has no reason
 * to see.
 */

/** Fields every signed-in user has, regardless of role. */
export type CommonProfile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: AppRole;
  /** Server-controlled: reflects Clerk email verification, not a user setting. */
  isVerified: boolean;
  address: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  avatarUrl: string | null;
  /** ISO-8601, or `null` when the account has no uploaded avatar. */
  avatarUpdatedAt: string | null;
  /** ISO-8601. Backs the honest "Member since" line. */
  createdAt: string;
  /** Fixed for every account; sent so the UI never hardcodes it. */
  communityRadiusMi: number;
};

export type HomeownerProfile = {
  notifyBids: boolean;
  notifyGroups: boolean;
  notifySavings: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  /** Read-only. Mirrors `communityRadiusMi`. */
  serviceRadiusMi: number;
};

export type ProviderProfile = {
  companyName: string | null;
  bio: string | null;
  trades: string[];
  /** Read-only. Mirrors `communityRadiusMi`. */
  serviceRadiusMi: number;
  workingDays: Weekday[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;

  /** Provider-supplied claims. Their presence proves nothing on its own. */
  licenseNumber: string | null;
  licenseState: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;

  /** Server/admin controlled — a provider cannot set these on themselves. */
  isLicenseVerified: boolean;
  isInsuranceVerified: boolean;
  licenseVerifiedAt: string | null;
  insuranceVerifiedAt: string | null;

  /** Display only. Bundleen stores no bank credentials. */
  payoutStatus: PayoutStatus;
  payoutLast4: string | null;
  payoutProvider: string | null;
  payoutUpdatedAt: string | null;

  notifyNewJobs: boolean;
  notifyMessages: boolean;
  notifyPayouts: boolean;
};

/** Result of an atomic save of the provider's common and business details. */
export type ProviderFullProfileResult = {
  profile: CommonProfile;
  provider: ProviderProfile;
};

/** Response of the avatar upload and removal handlers. `null` after removal. */
export type AvatarUploadResult = {
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
};

/** Error body shared by every profile route. */
export type ProfileErrorBody = {
  error: string;
  fields?: Record<string, string>;
};
