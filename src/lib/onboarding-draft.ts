import type { PublicRole } from "@/lib/validation/auth";
import type { SignUpName } from "@/lib/display-name";

export type ProviderBusinessDraft = {
  companyName: string;
  bio: string;
  services: string[];
  serviceArea: string;
  licenseNumber: string;
  insuranceProvider: string;
};

export type OnboardingDraft = {
  name: SignUpName;
  role: PublicRole;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  providerBusiness: ProviderBusinessDraft;
  /**
   * True only after the user deliberately entered Clerk's account step or
   * confirmed an already-active Clerk session. Older drafts intentionally
   * omit it and must return to the account confirmation screen.
   */
  completionAuthorized?: boolean;
};

const ONBOARDING_DRAFT_STORAGE_KEY = "bundleen.onboarding-draft";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isOnboardingDraft(value: unknown): value is OnboardingDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<OnboardingDraft>;
  const business = draft.providerBusiness as Partial<ProviderBusinessDraft> | undefined;

  return (
    typeof draft.name === "object" &&
    draft.name !== null &&
    isString(draft.name.firstName) &&
    Boolean(draft.name.firstName.trim()) &&
    isString(draft.name.lastName) &&
    Boolean(draft.name.lastName.trim()) &&
    (draft.role === "homeowner" || draft.role === "provider") &&
    isString(draft.address) &&
    Boolean(draft.address.trim()) &&
    isString(draft.neighborhood) &&
    typeof draft.latitude === "number" &&
    Number.isFinite(draft.latitude) &&
    draft.latitude >= -90 &&
    draft.latitude <= 90 &&
    typeof draft.longitude === "number" &&
    Number.isFinite(draft.longitude) &&
    draft.longitude >= -180 &&
    draft.longitude <= 180 &&
    (draft.completionAuthorized === undefined ||
      typeof draft.completionAuthorized === "boolean") &&
    typeof business === "object" &&
    business !== null &&
    isString(business.companyName) &&
    isString(business.bio) &&
    Array.isArray(business.services) &&
    business.services.every(isString) &&
    isString(business.serviceArea) &&
    isString(business.licenseNumber) &&
    isString(business.insuranceProvider)
  );
}

/**
 * Keeps pre-verification onboarding data in this browser tab only. The draft
 * is sent to the authenticated API after Clerk completes email verification.
 */
export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The live component still holds the draft if browser storage is disabled.
  }
}

export function getOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY) ?? "null") as unknown;
    return isOnboardingDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing else needs to happen when browser storage is unavailable.
  }
}
