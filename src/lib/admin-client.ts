import type {
  AdminErrorBody,
  CommunityDetail,
  ProviderDetail,
  StaffCandidate,
} from "@/lib/community-types";

/**
 * Browser-side calls into `/api/admin/**`.
 *
 * Thin on purpose. Every rule lives on the server; these helpers exist to send
 * a request, surface the server's message, and hand back the refreshed payload
 * the endpoints already return so a screen does not have to re-fetch.
 */

export class AdminRequestError extends Error {
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "AdminRequestError";
    this.status = status;
    this.fields = fields;
  }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = (payload ?? {}) as AdminErrorBody;
    throw new AdminRequestError(
      response.status,
      body.error ?? "Something went wrong. Please try again.",
      body.fields,
    );
  }

  return payload as T;
}

/* ── Communities ─────────────────────────────────────────────────────────── */

export type CommunityCreateBody = {
  name: string;
  type: "hoa" | "neighborhood";
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  radiusMiles?: number | null;
};

export function createCommunity(body: CommunityCreateBody) {
  return send<CommunityDetail>("/api/admin/communities", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type CommunityPatchBody = Partial<{
  name: string;
  status: "active" | "archived";
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
}>;

export function updateCommunity(communityId: string, body: CommunityPatchBody) {
  return send<CommunityDetail>(`/api/admin/communities/${communityId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function addCommunityMember(
  communityId: string,
  body: { userId: string; status: "pending" | "active"; isAdminOverride?: boolean; note?: string | null },
) {
  return send<CommunityDetail>(`/api/admin/communities/${communityId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCommunityMember(
  communityId: string,
  membershipId: string,
  body: {
    status?: "pending" | "active" | "removed";
    isPrimary?: boolean;
    isAdminOverride?: boolean;
    note?: string | null;
  },
) {
  return send<CommunityDetail & { revokedStaffRoles: string[] }>(
    `/api/admin/communities/${communityId}/members/${membershipId}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function assignStaffRole(
  communityId: string,
  body: {
    userId: string;
    role: "neighborhood_manager" | "hoa_manager" | "hoa_team";
    replaceExistingManager?: boolean;
    note?: string | null;
  },
) {
  return send<CommunityDetail & { replacedAssignmentId: string | null }>(
    `/api/admin/communities/${communityId}/staff`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function revokeStaffAssignment(communityId: string, assignmentId: string) {
  return send<CommunityDetail>(
    `/api/admin/communities/${communityId}/staff/${assignmentId}`,
    { method: "DELETE" },
  );
}

export function fetchStaffCandidates(communityId: string, role: string, search: string) {
  const params = new URLSearchParams({ role });
  if (search) params.set("search", search);

  return send<{ candidates: StaffCandidate[] }>(
    `/api/admin/communities/${communityId}/candidates?${params.toString()}`,
  );
}

export function fetchHomeownerCandidates(communityId: string, search: string) {
  const params = new URLSearchParams({ communityId, search });
  return send<{ candidates: StaffCandidate[] }>(
    `/api/admin/homeowners?${params.toString()}`,
  );
}

/* ── Providers ───────────────────────────────────────────────────────────── */

export type ProviderAdminPatchBody = Partial<{
  accountStatus: "pending" | "active" | "suspended";
  license: "verify" | "revoke";
  insurance: "verify" | "revoke";
  expectedUpdatedAt: string;
  note: string | null;
}>;

export function updateProvider(userId: string, body: ProviderAdminPatchBody) {
  return send<ProviderDetail & { changed: boolean }>(`/api/admin/providers/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
