import { apiFetch } from "./api";

const TOKEN_KEY = "neighbid.token";

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";
const DEV_BYPASS_TOKEN = "dev-bypass-token";
const DEV_BYPASS_USER: AuthUser = {
  id: 1,
  email: "alice@neighbid.com",
  full_name: "Alice Dev",
  phone: null,
  role: "homeowner",
  neighborhood: "Maple Grove",
  address: "123 Maple Grove Ave",
  latitude: null,
  longitude: null,
  neighbourhood_id: 1,
  is_verified: true,
};

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  phone?: string | null;
  role: "homeowner" | "provider" | "admin";
  neighborhood: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  neighbourhood_id?: number | null;
  is_verified: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

/* ── Token storage ── */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) return stored;
  return DEV_BYPASS ? DEV_BYPASS_TOKEN : null;
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("neighbid.role");
}

/* ── Auth calls (local SQLite-backed API auth) ── */
export async function register(payload: {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  role: string;
  latitude?: number;
  longitude?: number;
}): Promise<AuthTokens> {
  return apiFetch<AuthTokens>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(token: string): Promise<AuthUser> {
  if (DEV_BYPASS && token === DEV_BYPASS_TOKEN) return DEV_BYPASS_USER;
  return apiFetch<AuthUser>("/users/me", { token });
}

export function logout(): void {
  clearAuth();
  if (typeof window !== "undefined") window.location.href = "/";
}
