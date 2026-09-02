import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  grant: null as Record<string, unknown> | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ invitations: {} }),
}));

vi.mock("@/lib/server/notifications", () => ({
  buildPreferenceAwareNotificationOps: async () => [],
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    adminAccessGrant: {
      findUnique: async () => state.grant,
    },
    $transaction: vi.fn(),
  },
}));

const { revokeAdminAccess, setAdminPermissions } = await import("@/lib/server/admin-access");

beforeEach(() => {
  state.grant = {
    id: "grant-1",
    email: "staff@bundleen.com",
    level: "admin",
    status: "active",
    isStaffAccount: true,
    userId: "staff-1",
    previousRole: null,
    clerkInvitationId: null,
  };
});

describe("Bundleen staff authorization boundaries", () => {
  it("never grants administrator permissions to an ordinary staff row", async () => {
    await expect(
      setAdminPermissions({
        actorUserId: "owner-1",
        grantId: "grant-1",
        permissions: ["staff:manage"],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not let the staff page revoke a privileged administrator", async () => {
    state.grant = { ...state.grant!, isStaffAccount: false, userId: "admin-2" };

    await expect(
      revokeAdminAccess({
        actorUserId: "admin-1",
        grantId: "grant-1",
        expectedStaffAccount: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not let a staff manager remove their own access", async () => {
    await expect(
      revokeAdminAccess({
        actorUserId: "staff-1",
        grantId: "grant-1",
        expectedStaffAccount: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
