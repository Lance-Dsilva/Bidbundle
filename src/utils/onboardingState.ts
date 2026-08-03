export type UserRole = "homeowner" | "provider" | "admin";

const STORAGE_KEY = "neighbid.role";

export function saveRole(role: UserRole): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, role);
}

export function getRole(): UserRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (localStorage.getItem(STORAGE_KEY) as UserRole) ?? null;
}
