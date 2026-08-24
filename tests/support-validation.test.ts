import { describe, expect, it } from "vitest";

import {
  ADMIN_PERMISSIONS,
  hasAdminPermission,
  isAdminPermission,
  normalizeAdminPermissions,
} from "@/lib/admin-permissions";
import {
  GLOBAL_SEND_CONFIRMATION,
  URGENT_OPERATIONAL_SEVERITIES,
  broadcastDraftSchema,
  broadcastSendSchema,
} from "@/lib/validation/communications";
import {
  MAX_TICKET_MESSAGE_LENGTH,
  adminTicketMessageSchema,
  adminTicketQuerySchema,
  adminTicketUpdateSchema,
  aiDraftApprovalSchema,
  createTicketSchema,
  normalizeTicketText,
} from "@/lib/validation/support";

describe("normalizeTicketText", () => {
  it("normalizes line endings and trims", () => {
    expect(normalizeTicketText("  a\r\nb  ")).toBe("a\nb");
  });

  it("strips control characters a paste can carry, keeping tabs and newlines", () => {
    expect(normalizeTicketText("a\u0000b\u0007c\td\ne")).toBe("abc\td\ne");
  });

  it("collapses runaway blank lines without touching ordinary paragraphs", () => {
    expect(normalizeTicketText("a\n\nb")).toBe("a\n\nb");
    expect(normalizeTicketText("a\n\n\n\n\n\nb")).toBe("a\n\n\nb");
  });

  it("does not mangle characters a customer legitimately typed", () => {
    // Safety comes from rendering as text, not from stripping markup — doing
    // the latter would corrupt real messages like this one.
    const message = "my bid is < $500 & the <b> tag showed up in my email";
    expect(normalizeTicketText(message)).toBe(message);
  });
});

describe("createTicketSchema", () => {
  const valid = { subject: "Cannot see my bids", category: "bidding", message: "Nothing loads." };

  it("accepts a complete request", () => {
    expect(createTicketSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects blank subject or message", () => {
    expect(createTicketSchema.safeParse({ ...valid, subject: "   " }).success).toBe(false);
    expect(createTicketSchema.safeParse({ ...valid, message: "\n\n" }).success).toBe(false);
  });

  it("rejects a message beyond the length ceiling", () => {
    expect(
      createTicketSchema.safeParse({ ...valid, message: "x".repeat(MAX_TICKET_MESSAGE_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(createTicketSchema.safeParse({ ...valid, category: "refunds" }).success).toBe(false);
  });

  it("refuses fields the customer does not own", () => {
    // The whole privilege boundary in one assertion: a customer body that names
    // its own status, priority, assignee, requester, or ticket number fails.
    for (const forged of [
      { status: "resolved" },
      { priority: "urgent" },
      { assignedAdminUserId: "someone" },
      { requesterUserId: "someone-else" },
      { ticketNumber: "BDL-000001" },
    ]) {
      expect(createTicketSchema.safeParse({ ...valid, ...forged }).success).toBe(false);
    }
  });
});

describe("admin ticket mutations", () => {
  const token = { expectedUpdatedAt: new Date().toISOString() };

  it("requires the concurrency token on every write", () => {
    expect(adminTicketMessageSchema.safeParse({ message: "hi" }).success).toBe(false);
    expect(adminTicketUpdateSchema.safeParse({ status: "open" }).success).toBe(false);
    expect(
      aiDraftApprovalSchema.safeParse({ draftId: "d1", message: "hi" }).success,
    ).toBe(false);
  });

  it("defaults a reply to customer-visible rather than internal", () => {
    const result = adminTicketMessageSchema.safeParse({ ...token, message: "Sorted." });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.internal).toBe(false);
  });

  it("accepts an internal note with an optional status change", () => {
    expect(
      adminTicketMessageSchema.safeParse({
        ...token,
        message: "Checked their bids.",
        internal: true,
        status: "pending_internal",
      }).success,
    ).toBe(true);
  });

  it("rejects an update that changes nothing", () => {
    expect(adminTicketUpdateSchema.safeParse(token).success).toBe(false);
  });

  it("allows unassigning with an explicit null", () => {
    expect(
      adminTicketUpdateSchema.safeParse({ ...token, assignedAdminUserId: null }).success,
    ).toBe(true);
  });

  it("rejects an invalid concurrency token", () => {
    expect(
      adminTicketUpdateSchema.safeParse({ expectedUpdatedAt: "yesterday", status: "open" }).success,
    ).toBe(false);
  });
});

describe("adminTicketQuerySchema", () => {
  it("applies safe defaults for an empty query", () => {
    const result = adminTicketQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe("recent_activity");
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it("coerces numeric query-string values", () => {
    const result = adminTicketQuerySchema.safeParse({ page: "3", pageSize: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("caps the page size so one request cannot pull the whole queue", () => {
    expect(adminTicketQuerySchema.safeParse({ pageSize: "5000" }).success).toBe(false);
  });

  it("rejects an unknown sort or filter key", () => {
    expect(adminTicketQuerySchema.safeParse({ sort: "random" }).success).toBe(false);
    expect(adminTicketQuerySchema.safeParse({ requesterUserId: "x" }).success).toBe(false);
  });
});

describe("broadcastDraftSchema", () => {
  const valid = {
    subject: "Scheduled maintenance",
    body: "We will be offline 06:00–08:00 UTC.",
    severity: "maintenance" as const,
  };

  it("accepts a minimal draft and defaults to the whole audience", () => {
    const result = broadcastDraftSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceSegments).toEqual([]);
      expect(result.data.overridesEmailPreference).toBe(false);
    }
  });

  it.each(URGENT_OPERATIONAL_SEVERITIES)(
    "allows a preference override for severity %s",
    (severity) => {
      expect(
        broadcastDraftSchema.safeParse({ ...valid, severity, overridesEmailPreference: true })
          .success,
      ).toBe(true);
    },
  );

  it("refuses a preference override on an ordinary announcement", () => {
    // The one rule that protects a customer's stated email preference from
    // being routed around by relabelling marketing as operations.
    const result = broadcastDraftSchema.safeParse({
      ...valid,
      severity: "announcement",
      overridesEmailPreference: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an off-site or protocol-relative link", () => {
    for (const linkPath of [
      "https://evil.example/phish",
      "//evil.example/phish",
      "javascript:alert(1)",
    ]) {
      expect(broadcastDraftSchema.safeParse({ ...valid, linkPath }).success).toBe(false);
    }
    expect(
      broadcastDraftSchema.safeParse({ ...valid, linkPath: "/app/homeowner/dashboard" }).success,
    ).toBe(true);
  });

  it("requires both parts of an in-app notification or neither", () => {
    expect(broadcastDraftSchema.safeParse({ ...valid, inAppTitle: "Heads up" }).success).toBe(false);
    expect(broadcastDraftSchema.safeParse({ ...valid, inAppBody: "Details" }).success).toBe(false);
    expect(
      broadcastDraftSchema.safeParse({ ...valid, inAppTitle: "Heads up", inAppBody: "Details" })
        .success,
    ).toBe(true);
  });

  it("refuses a client-supplied recipient list or count", () => {
    expect(broadcastDraftSchema.safeParse({ ...valid, recipientCount: 5 }).success).toBe(false);
    expect(
      broadcastDraftSchema.safeParse({ ...valid, recipients: ["a@example.com"] }).success,
    ).toBe(false);
  });

  it("rejects unknown audience segments", () => {
    expect(
      broadcastDraftSchema.safeParse({ ...valid, audienceSegments: ["admins"] }).success,
    ).toBe(false);
  });
});

describe("broadcastSendSchema", () => {
  it("requires the exact confirmation phrase", () => {
    expect(
      broadcastSendSchema.safeParse({
        confirmation: GLOBAL_SEND_CONFIRMATION,
        acknowledgedRecipientCount: 100,
      }).success,
    ).toBe(true);

    for (const confirmation of ["send to all", "SEND TO ALL ", "yes", ""]) {
      expect(
        broadcastSendSchema.safeParse({ confirmation, acknowledgedRecipientCount: 100 }).success,
      ).toBe(false);
    }
  });

  it("requires the reviewed recipient count", () => {
    expect(
      broadcastSendSchema.safeParse({ confirmation: GLOBAL_SEND_CONFIRMATION }).success,
    ).toBe(false);
  });
});

describe("admin permissions", () => {
  it("recognizes only the closed list", () => {
    for (const permission of ADMIN_PERMISSIONS) expect(isAdminPermission(permission)).toBe(true);
    for (const bogus of ["communications:everything", "", null, 7]) {
      expect(isAdminPermission(bogus)).toBe(false);
    }
  });

  it("drops unknown strings rather than storing them", () => {
    expect(
      normalizeAdminPermissions(["communications:draft", "sudo", "communications:draft"]),
    ).toEqual(["communications:draft"]);
  });

  it("gives the owner every permission implicitly", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(hasAdminPermission({ level: "owner", permissions: [] }, permission)).toBe(true);
    }
  });

  it("gives a plain admin nothing by default", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(hasAdminPermission({ level: "admin", permissions: [] }, permission)).toBe(false);
    }
  });

  it("grants an admin exactly what is stored — drafting never implies sending", () => {
    const access = { level: "admin" as const, permissions: ["communications:draft"] };
    expect(hasAdminPermission(access, "communications:draft")).toBe(true);
    expect(hasAdminPermission(access, "communications:send_global")).toBe(false);
  });

  it("gives a non-admin nothing, whatever the permissions column says", () => {
    expect(
      hasAdminPermission({ level: null, permissions: ["communications:send_global"] }, "communications:send_global"),
    ).toBe(false);
  });
});
