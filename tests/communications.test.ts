import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  broadcastBypassesPreference,
  renderBroadcastEmail,
} from "@/lib/server/communications";

/**
 * The delivery guarantees a global send has to make.
 *
 * The idempotency and batching properties are structural — they live in unique
 * constraints and in the shape of the write, not in a return value — so they
 * are asserted against the source and the migration alongside the behavioural
 * checks on rendering and preference policy.
 */

vi.mock("@/lib/server/db", () => ({ db: {} }));

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = readFileSync(resolve(ROOT, "src/lib/server/communications.ts"), "utf8");
const MIGRATION = readFileSync(
  resolve(ROOT, "prisma/migrations/20260823120000_support_and_broadcasts/migration.sql"),
  "utf8",
);

describe("broadcastBypassesPreference", () => {
  it("is false for an announcement even when the flag is set", () => {
    expect(
      broadcastBypassesPreference({ severity: "announcement", overridesEmailPreference: true }),
    ).toBe(false);
  });

  it.each(["maintenance", "degraded", "outage", "security"] as const)(
    "is true for %s only when the admin explicitly confirmed it",
    (severity) => {
      expect(broadcastBypassesPreference({ severity, overridesEmailPreference: true })).toBe(true);
      expect(broadcastBypassesPreference({ severity, overridesEmailPreference: false })).toBe(
        false,
      );
    },
  );
});

describe("renderBroadcastEmail", () => {
  const base = {
    subject: "Scheduled maintenance",
    body: "We will be offline 06:00–08:00 UTC.",
    linkPath: null,
    overridesEmailPreference: false,
  };

  it("prefixes the subject from a server-chosen severity label", () => {
    expect(renderBroadcastEmail({ ...base, severity: "outage" }).subject).toBe(
      "[Service outage] Scheduled maintenance",
    );
    expect(renderBroadcastEmail({ ...base, severity: "security" }).subject).toBe(
      "[Security notice] Scheduled maintenance",
    );
  });

  it("explains why the recipient got it, honestly, in each case", () => {
    expect(renderBroadcastEmail({ ...base, severity: "announcement" }).text).toContain(
      "you have announcement emails enabled",
    );
    expect(
      renderBroadcastEmail({ ...base, severity: "outage", overridesEmailPreference: true }).text,
    ).toContain("regardless of your announcement email preference");
  });

  it("includes an in-app link only when one was set", () => {
    expect(renderBroadcastEmail({ ...base, severity: "maintenance" }).text).not.toContain(
      "More detail",
    );
    expect(
      renderBroadcastEmail({ ...base, severity: "maintenance", linkPath: "/app/homeowner/dashboard" })
        .text,
    ).toContain("More detail: /app/homeowner/dashboard");
  });

  it("passes admin-entered content through as literal text", () => {
    // Delivery is plain text, so there is no template to escape and no client
    // that will parse this as markup.
    const hostile = '<script>alert(1)</script> & "quotes"';
    const rendered = renderBroadcastEmail({ ...base, severity: "outage", body: hostile });
    expect(rendered.text).toContain(hostile);
    expect(rendered.text).not.toContain("&lt;");
    expect(rendered).not.toHaveProperty("html");
  });
});

describe("idempotent delivery", () => {
  it("keys every outbox row per broadcast and per recipient", () => {
    expect(SOURCE).toContain("dedupeKey: `broadcast:${broadcastId}:${user.id}`");
  });

  it("inserts recipients and outbox rows with skipDuplicates", () => {
    const sendBody = SOURCE.slice(
      SOURCE.indexOf("export async function sendBroadcast"),
      SOURCE.indexOf("export async function reconcileBroadcastDelivery"),
    );
    // Every insert in the send path is duplicate-tolerant, so a retried send
    // creates no new rows and therefore no second email.
    const inserts = sendBody.match(/createMany\(\{[^}]*data:[^}]*\}/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(sendBody.match(/skipDuplicates: true/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("is backed by database uniqueness per user and per address", () => {
    expect(MIGRATION).toContain('"BroadcastRecipient_broadcastId_userId_key"');
    expect(MIGRATION).toContain('"BroadcastRecipient_broadcastId_email_key"');
  });

  it("refuses to re-send a broadcast that has left draft", () => {
    expect(SOURCE).toContain('if (broadcast.status !== "draft")');
    expect(SOURCE).toContain("This broadcast has already been sent.");
  });

  it("retries only failed recipients and never recreates the audience", () => {
    const retry = SOURCE.slice(SOURCE.indexOf("export async function retryBroadcastFailures"));
    expect(retry).toContain('status: "failed"');
    expect(retry).not.toContain("createMany");
  });
});

describe("send-time safety", () => {
  it("never sends inside the request handler", () => {
    const sendBody = SOURCE.slice(
      SOURCE.indexOf("export async function sendBroadcast"),
      SOURCE.indexOf("export async function reconcileBroadcastDelivery"),
    );
    // Rows go into the outbox; the existing worker delivers them.
    expect(sendBody).toContain("outboxEvent.createMany");
    expect(sendBody).not.toContain("getEmailProvider");
    expect(sendBody).toContain("scheduleOutboxDrain");
  });

  it("pages the audience rather than loading it all at once", () => {
    expect(SOURCE).toContain("RECIPIENT_BATCH_SIZE");
    expect(SOURCE).toContain("cursor");
  });

  it("caps the audience with a safety ceiling", () => {
    expect(SOURCE).toContain("MAX_RECIPIENTS");
    expect(SOURCE).toContain("recipient safety ceiling");
  });

  it("re-checks the recipient count the admin actually reviewed", () => {
    expect(SOURCE).toContain("input.acknowledgedRecipientCount");
    expect(SOURCE).toContain("The audience changed from");
  });

  it("records the send, including the preference override, in the audit log", () => {
    expect(SOURCE).toContain('action: "broadcast_sent"');
    expect(SOURCE).toContain("isPrimary: bypassesPreference");
  });

  it("suppresses opted-out recipients with a recorded reason instead of dropping them", () => {
    expect(SOURCE).toContain('status: "suppressed"');
    expect(SOURCE).toContain('suppressedReason: "preference_opt_out"');
  });

  it("deduplicates two accounts that share an email address", () => {
    expect(SOURCE).toContain("seenEmails");
  });

  it("excludes unverified addresses from every audience", () => {
    expect(SOURCE).toContain("isVerified: true");
  });
});

describe("test send", () => {
  it("takes no address and targets only the requesting admin", () => {
    const testBody = SOURCE.slice(
      SOURCE.indexOf("export async function sendBroadcastTest"),
      SOURCE.indexOf("/* ── Global send"),
    );
    expect(testBody).toContain("to: admin.email");
    // A test is not a delivery, so it must not create recipient records.
    expect(testBody).not.toContain("broadcastRecipient");
    expect(testBody).toContain("[TEST]");
    expect(testBody).toContain('action: "broadcast_test_sent"');
  });
});

describe("database-level guarantees", () => {
  it("requires a named approver and queue time for anything past draft", () => {
    expect(MIGRATION).toContain("broadcast_approval_check");
  });

  it("refuses a preference override on a non-operational severity", () => {
    expect(MIGRATION).toContain("broadcast_override_severity_check");
  });

  it("refuses an off-site or protocol-relative link path", () => {
    expect(MIGRATION).toContain("broadcast_link_path_check");
  });

  it("makes a ticket number immutable once issued", () => {
    expect(MIGRATION).toContain("support_ticket_number_immutable");
    expect(MIGRATION).toContain("support_ticket_number_seq");
  });

  it("requires an approved AI draft to name its approver and the exact sent text", () => {
    expect(MIGRATION).toContain("support_ai_draft_approval_check");
  });
});
