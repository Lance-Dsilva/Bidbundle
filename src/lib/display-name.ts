export type SignUpName = Readonly<{
  firstName: string;
  lastName: string;
}>;

const SIGN_UP_NAME_STORAGE_KEY = "bundleen.sign-up-name";

/** Uses the first and last words so middle names do not replace the surname. */
export function initialsFromName(name: string | null | undefined, fallback = "NB"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;

  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase() || fallback;
}

export function fullNameFromSignUp(name: SignUpName): string {
  return `${name.firstName.trim()} ${name.lastName.trim()}`;
}

/**
 * A short-lived hand-off between Clerk's sign-up screen and onboarding.
 * This is display/profile input only; it is never used for authorization.
 */
export function saveSignUpName(name: SignUpName): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGN_UP_NAME_STORAGE_KEY, JSON.stringify(name));
  } catch {
    // The live component still passes the name to Clerk if storage is disabled.
  }
}

export function getSignUpName(): SignUpName | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = JSON.parse(sessionStorage.getItem(SIGN_UP_NAME_STORAGE_KEY) ?? "null") as unknown;
    if (
      typeof stored === "object" &&
      stored !== null &&
      "firstName" in stored &&
      "lastName" in stored &&
      typeof stored.firstName === "string" &&
      typeof stored.lastName === "string" &&
      stored.firstName.trim() &&
      stored.lastName.trim()
    ) {
      return { firstName: stored.firstName.trim(), lastName: stored.lastName.trim() };
    }
  } catch {
    // Treat corrupt or unavailable browser storage as an empty draft.
  }

  return null;
}

export function clearSignUpName(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SIGN_UP_NAME_STORAGE_KEY);
  } catch {
    // Nothing else needs to happen when browser storage is unavailable.
  }
}
