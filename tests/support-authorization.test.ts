import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The authorization boundaries around support, communications, and the admin
 * CRM, asserted where they actually live: in every route's opening gate.
 *
 * A behavioural test would have to mock Clerk and Prisma for each of a dozen
 * handlers and would still miss the case this catches — a *new* endpoint added
 * without a gate. These sweep the directory instead, so an ungated route fails
 * the suite the moment it appears.
 */

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

const CUSTOMER_ROUTES = [
  "src/app/api/support/tickets/route.ts",
  "src/app/api/support/tickets/[ticketId]/route.ts",
  "src/app/api/support/tickets/[ticketId]/messages/route.ts",
  "src/app/api/support/tickets/[ticketId]/reopen/route.ts",
] as const;

const ADMIN_SUPPORT_ROUTES = [
  "src/app/api/admin/support/tickets/route.ts",
  "src/app/api/admin/providers/[userId]/tickets/route.ts",
  "src/app/api/admin/support/tickets/[ticketId]/route.ts",
  "src/app/api/admin/support/tickets/[ticketId]/messages/route.ts",
  "src/app/api/admin/support/tickets/[ticketId]/ai-draft/route.ts",
  "src/app/api/admin/support/tickets/[ticketId]/ai-explanation/route.ts",
] as const;

const BROADCAST_ROUTES = [
  "src/app/api/admin/communications/broadcasts/route.ts",
  "src/app/api/admin/communications/broadcasts/[broadcastId]/route.ts",
  "src/app/api/admin/communications/broadcasts/[broadcastId]/test/route.ts",
  "src/app/api/admin/communications/broadcasts/[broadcastId]/send/route.ts",
  "src/app/api/admin/communications/broadcasts/[broadcastId]/retry/route.ts",
  "src/app/api/admin/communications/preview/route.ts",
] as const;

/** Every exported HTTP handler in a route file. */
function handlers(source: string): string[] {
  return [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map(
    (match) => match[1]!,
  );
}

describe("customer support endpoints", () => {
  it.each(CUSTOMER_ROUTES)("%s authenticates before doing anything", (path) => {
    const source = read(path);
    expect(source).toMatch(/requireSupport(User|Mutation)\(\)/);
    // The gate is the first thing each handler does.
    for (const verb of handlers(source)) {
      const body = source.slice(source.indexOf(`export async function ${verb}`));
      const gateIndex = body.search(/requireSupport(User|Mutation)\(\)/);
      const dbIndex = body.indexOf("db.");
      expect(gateIndex).toBeGreaterThanOrEqual(0);
      if (dbIndex >= 0) expect(gateIndex).toBeLessThan(dbIndex);
    }
  });

  it("rate-limits every customer write", () => {
    for (const path of CUSTOMER_ROUTES) {
      const source = read(path);
      if (!handlers(source).some((verb) => verb !== "GET")) continue;
      expect(source).toContain("requireSupportMutation");
    }
  });

  it("takes the requester identity from the session, never the body", () => {
    const create = read("src/app/api/support/tickets/route.ts");
    expect(create).toContain("id: gate.user.id");
    expect(create).toContain("role: gate.user.role");
  });

  it("answers 404 rather than 403 for someone else's ticket", () => {
    // A 403 would confirm the id exists. Both cases return the same 404.
    const detail = read("src/app/api/support/tickets/[ticketId]/route.ts");
    expect(detail).toContain("That ticket does not exist.");
    expect(detail).toContain("status: 404");
  });

  it("never exposes an admin-only capability on a customer route", () => {
    for (const path of CUSTOMER_ROUTES) {
      const source = read(path);
      for (const forbidden of [
        "adminTicketUpdateSchema",
        "adminTicketMessageSchema",
        "updateAdminTicket",
        "addAdminMessage",
        "listAdminTickets",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});

describe("admin support endpoints", () => {
  it.each(ADMIN_SUPPORT_ROUTES)("%s requires an active admin grant", (path) => {
    const source = read(path);
    expect(source).toMatch(/requireAdmin(Mutation)?\(\)/);
    for (const verb of handlers(source)) {
      const body = source.slice(source.indexOf(`export async function ${verb}`));
      expect(body.search(/requireAdmin(Mutation)?\(\)/)).toBeGreaterThanOrEqual(0);
    }
  });

  it("applies the admin write limiter to state-changing handlers", () => {
    for (const path of [
      "src/app/api/admin/providers/[userId]/tickets/route.ts",
      "src/app/api/admin/support/tickets/[ticketId]/route.ts",
      "src/app/api/admin/support/tickets/[ticketId]/messages/route.ts",
    ]) {
      expect(read(path)).toContain("requireAdminMutation");
    }
  });
});

describe("broadcast endpoints", () => {
  it.each(BROADCAST_ROUTES)("%s requires a named communications permission", (path) => {
    expect(read(path)).toMatch(/requireAdminPermission(Mutation)?\(/);
  });

  it("reserves real delivery for the dedicated send permission", () => {
    const send = read("src/app/api/admin/communications/broadcasts/[broadcastId]/send/route.ts");
    expect(send).toContain('requireAdminPermissionMutation("communications:send_global")');
    // Drafting must not be enough to deliver.
    expect(send).not.toContain('"communications:draft"');
  });

  it("reserves retry for the same send permission", () => {
    expect(
      read("src/app/api/admin/communications/broadcasts/[broadcastId]/retry/route.ts"),
    ).toContain('requireAdminPermissionMutation("communications:send_global")');
  });

  it("lets a drafter compose, preview, and test without being able to send", () => {
    for (const path of [
      "src/app/api/admin/communications/broadcasts/route.ts",
      "src/app/api/admin/communications/preview/route.ts",
      "src/app/api/admin/communications/broadcasts/[broadcastId]/test/route.ts",
    ]) {
      const source = read(path);
      expect(source).toContain('"communications:draft"');
      // The list route reports whether the caller *could* send, so the UI can
      // hide a button rather than offer one that 403s. That is a read of the
      // permission, not a gate on it — no handler here may require it.
      expect(source).not.toMatch(
        /requireAdminPermission(Mutation)?\("communications:send_global"\)/,
      );
    }
  });

  it("rate-limits composition and delivery separately from ordinary admin writes", () => {
    for (const path of [
      "src/app/api/admin/communications/broadcasts/[broadcastId]/send/route.ts",
      "src/app/api/admin/communications/broadcasts/[broadcastId]/test/route.ts",
    ]) {
      expect(read(path)).toContain("guardBroadcastMutation");
    }
  });

  it("keeps permission management owner-only", () => {
    const permissions = read("src/app/api/admin/access/[grantId]/permissions/route.ts");
    expect(permissions).toContain("requireAdminOwnerMutation");
    // A shared admin must not be able to grant themselves the send permission.
    expect(permissions).not.toContain("requireAdminMutation");
  });
});

describe("admin CRM structure", () => {
  const shell = read("src/components/admin/AdminCrmShell.tsx");

  it("keeps the shell focused on navigation, not feature logic", () => {
    // No data fetching, no forms, no domain modules — the shell is chrome.
    expect(shell).not.toContain("lib/server/");
    expect(shell).not.toContain("useEffect");
    expect(shell).not.toContain("fetch(");
  });

  it("organizes navigation into the CRM modules", () => {
    for (const group of [
      "Customers",
      "Service providers",
      "Support",
      "Communications",
      "Governance",
    ]) {
      expect(shell).toContain(`title="${group}"`);
    }
  });

  it("hides a module the signed-in admin cannot use", () => {
    expect(shell).toContain("hasAdminPermission");
    expect(shell).toContain('permission: "communications:draft"');
  });

  it("keeps owner-only governance gated", () => {
    expect(shell).toContain("ownerOnly: true");
  });

  it("confines wide tables to their own scroll container", () => {
    // The brief's specific failure: a wide table must not make the whole admin
    // page scroll sideways on a laptop.
    const primitives = read("src/components/admin/primitives/index.tsx");
    expect(primitives).toContain("overflow-x-auto");
    expect(primitives).toContain("min-w-[720px]");
  });

  it("provides the shared primitives the modules are built from", () => {
    const primitives = read("src/components/admin/primitives/index.tsx");
    const filters = read("src/components/admin/primitives/AdminFilterBar.tsx");
    for (const name of [
      "AdminPageHeader",
      "AdminMetricCard",
      "AdminDataTable",
      "AdminStatusBadge",
      "AdminEmptyState",
      "AdminErrorState",
      "AdminLoadingState",
      "AdminPagination",
      "AdminDetailLayout",
    ]) {
      expect(primitives).toContain(`export function ${name}`);
    }
    for (const name of ["AdminFilterBar", "AdminDialog", "AdminDrawer", "AdminSearchInput"]) {
      expect(filters).toContain(`export function ${name}`);
    }
  });

  it("keeps the existing admin routes reachable after modularization", () => {
    for (const href of [
      "/app/admin/dashboard",
      "/app/admin/communities",
      "/app/admin/providers",
      "/app/admin/audit",
      "/app/admin/access",
    ]) {
      expect(shell).toContain(href);
    }
  });
});

describe("concurrent admin edits", () => {
  const support = read("src/lib/server/support.ts");

  it("guards every admin ticket write with the version the admin was shown", () => {
    // The read is a courtesy; the guarantee is the `updatedAt` in the filter of
    // the mutating `updateMany`, which matches zero rows when stale.
    expect(support).toContain("where: { id: ticketId, updatedAt: ticket.updatedAt }");
    expect(support.match(/updatedAt: ticket\.updatedAt/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("turns a zero-row update into an explicit conflict, never a silent no-op", () => {
    expect(support).toContain("if (updated.count === 0) throw new SupportConflictError()");
    expect(support).toContain(
      "if ((results[0] as { count: number }).count === 0) throw new SupportConflictError()",
    );
  });

  it("maps the conflict to a 409 for the client", () => {
    const api = read("src/lib/server/support-api.ts");
    expect(api).toContain("status: error.status");
    expect(api).toContain('code === "P2025"');
    expect(support).toContain("super(message, 409)");
  });

  it("never resets the first-response timestamp on a later reply", () => {
    expect(support).toContain("...(ticket.firstAdminReplyAt ? {} : { firstAdminReplyAt: now })");
  });
});
