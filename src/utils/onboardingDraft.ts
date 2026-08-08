/**
 * Onboarding data that authentication collects but does not yet store.
 *
 * The phase-one `User` model holds only identity and role. The address,
 * coordinates, and provider business details gathered during sign-up have no
 * column to go to, so rather than dropping them on submit they are kept here
 * until section 2 (User Profiles) adds the models and a `PATCH /api/profile`
 * handler to persist them.
 *
 * ── Handoff notes for the profiles task ──
 *
 * 1. Nothing in here is trusted. The browser supplied all of it, including the
 *    geolocation fix, so the "verified 14 months / USPS verified" copy in
 *    `VerifyAreaStep` is presentational — real residency verification must
 *    happen server-side before it means anything.
 * 2. Coordinates are approximate and user-grantable. Treat them as a hint for
 *    matching, never as proof of address.
 * 3. `sessionStorage`, not `localStorage`: this is a short-lived draft that
 *    should not outlive the tab, and it must never become a second source of
 *    truth for anything the server decides.
 */

const DRAFT_KEY = "bundleen.onboardingDraft";

export type OnboardingDraft = {
  address: string;
  coords: { lat: number; lng: number } | null;
  providerBusiness?: {
    companyName: string;
    bio: string;
    services: string[];
    serviceArea: string;
    serviceRadius: number;
    isLicensed: boolean;
    licenseNumber: string;
    isInsured: boolean;
  };
};

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be full or blocked by privacy settings. Losing a draft is
    // not worth failing a completed registration over.
  }
}

export function readOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : null;
  } catch {
    return null;
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing actionable.
  }
}
