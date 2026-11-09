import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvedProviderVerification } from "./fixtures/provider-verification";

type Row = Record<string, unknown>;
type Write = { model: string; args: Row };
const state = vi.hoisted(() => ({
  documents: [] as Row[], notifications: [] as Row[], batches: [] as Write[][],
  nextError: null as unknown, find: vi.fn(),
}));
const plan = (model: string) => (args: Row): Write => ({ model, args });

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Row[]).every((condition) => matches(row, condition));
    if (value instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === value.getTime();
    if (value && typeof value === "object" && "equals" in value) return row[key] === value.equals;
    return row[key] === value;
  });
}

vi.mock("@/lib/server/db", () => ({ db: {
  mediaAsset: {
    findMany: async (args: Row) => {
      state.find(args);
      // The database excludes removed/non-approved versions before the sweep.
      return state.documents.filter((doc) => doc.status === "active" && doc.credentialReviewStatus === "approved").slice(0, args.take as number);
    },
    update: plan("document"),
  },
  providerProfile: { update: plan("profile"), findUnique: async (args: { where: { id: string } }) =>
    state.documents.map((doc) => doc.providerProfile as Row).find((profile) => profile.id === args.where.id) ?? null },
  adminAuditLog: { create: plan("audit") },
  $transaction: async (operations: Write[]) => {
    if (state.nextError) { const error = state.nextError; state.nextError = null; throw error; }
    // Check every CAS before applying any operation: a losing batch changes
    // neither markers nor notification rows. PostgreSQL race tests run apart.
    for (const operation of operations) {
      if (operation.model !== "profile" && operation.model !== "document") continue;
      const candidates = operation.model === "profile" ? state.documents.map((doc) => doc.providerProfile as Row) : state.documents;
      if (!candidates.some((row) => matches(row, operation.args.where as Row))) throw { code: "P2025" };
    }
    for (const operation of operations) {
      if (operation.model === "profile" || operation.model === "document") {
        const candidates = operation.model === "profile" ? state.documents.map((doc) => doc.providerProfile as Row) : state.documents;
        const target = candidates.find((row) => matches(row, operation.args.where as Row))!;
        Object.assign(target, operation.args.data);
      } else if (operation.model === "notification") {
        const intent = operation.args.data as Row;
        if (!state.notifications.some((row) => row.dedupeKey === intent.dedupeKey)) state.notifications.push(intent);
      }
    }
    state.batches.push(operations);
    return operations;
  },
} }));
vi.mock("@/lib/server/notifications", () => ({
  buildPreferenceAwareNotificationOps: async (intents: Row[]) => intents.map((intent) => plan("notification")({ data: intent })),
}));

const { sweepProviderCredentialExpirations } = await import("@/lib/server/provider-credential-expiry");
const NOW = new Date("2026-11-08T23:59:59.999Z");
const DAY = 86_400_000;
function expiresIn(days: number) { return new Date(Date.UTC(2026, 10, 8) + days * DAY); }

function document(kind: "license" | "insurance" = "license", days = 30): Row {
  const profile = { ...approvedProviderVerification(), userId: "provider-1", user: { email: "provider@example.invalid" } };
  const source = kind === "license" ? profile.licenseDocument : profile.insuranceDocument;
  const expiry = expiresIn(days);
  if (kind === "license") profile.licenseExpiresAt = expiry;
  else profile.insuranceExpiresAt = expiry;
  return { ...source, credentialExpiresAt: expiry, credentialReminder30At: null, credentialReminder7At: null, providerProfile: profile };
}

beforeEach(() => {
  vi.clearAllMocks(); state.documents = [document()]; state.notifications = []; state.batches = []; state.nextError = null;
});

describe("provider credential renewal reminders", () => {
  it.each([[30, 30], [8, 30], [7, 7], [0, 7]])("queues one appropriate reminder with %i days remaining", async (days, threshold) => {
    state.documents = [document("license", days)];
    const result = await sweepProviderCredentialExpirations(NOW);
    expect(result).toEqual({ expired: 0, remindersQueued: 1 });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({ userId: "provider-1", emailPolicy: "required", kind: "reminder",
      dedupeKey: `credential-reminder:license-document-1:${expiresIn(days).toISOString().slice(0, 10)}:${threshold}` });
    expect(String(state.notifications[0].body)).toContain("valid through that UTC date");
    expect(JSON.stringify(state.notifications)).not.toMatch(/storageUrl|storagePath|POL-1|private-token/);
  });

  it("does not repeat the 30-day message and can later send the distinct 7-day reminder", async () => {
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 1 });
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    const sevenDaysBefore = new Date(NOW.getTime() + 23 * DAY);
    expect(await sweepProviderCredentialExpirations(sevenDaysBefore)).toEqual({ expired: 0, remindersQueued: 1 });
    expect(await sweepProviderCredentialExpirations(sevenDaysBefore)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.notifications.map((row) => String(row.dedupeKey).split(":").at(-1))).toEqual(["30", "7"]);
    expect(state.batches).toHaveLength(2);
  });

  it("a late first run sends only the urgent reminder and marks the obsolete 30-day one covered", async () => {
    state.documents = [document("insurance", 3)];
    await sweepProviderCredentialExpirations(NOW);
    expect(state.documents[0]).toMatchObject({ credentialReminder30At: NOW, credentialReminder7At: NOW });
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].dedupeKey).toMatch(/:7$/);
  });

  it("does not consume a reminder or enqueue notices when a competing write wins the CAS", async () => {
    state.nextError = { code: "P2025" };
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.documents[0].credentialReminder30At).toBeNull();
    expect(state.notifications).toEqual([]); expect(state.batches).toEqual([]);
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 1 });
    expect(state.notifications).toHaveLength(1);
  });

  it("reports an unexpected database failure without swallowing it or consuming a marker", async () => {
    const failure = new Error("database unavailable"); state.nextError = failure;
    await expect(sweepProviderCredentialExpirations(NOW)).rejects.toBe(failure);
    expect(state.documents[0].credentialReminder30At).toBeNull(); expect(state.notifications).toEqual([]);
  });

  it("uses a new document identity for renewed evidence even with the same expiration date", async () => {
    await sweepProviderCredentialExpirations(NOW);
    const replacement = document(); replacement.id = "renewed-document-2";
    (replacement.providerProfile as Row).licenseDocumentId = "renewed-document-2";
    state.documents = [replacement];
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 1 });
    expect(new Set(state.notifications.map((row) => row.dedupeKey)).size).toBe(2);
  });
});

describe("automatic credential expiry and bounded work", () => {
  it.each(["license", "insurance"] as const)("expires %s approval after its UTC day and leaves the other credential alone", async (kind) => {
    state.documents = [document(kind, -1)];
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 1, remindersQueued: 0 });
    const profile = state.documents[0].providerProfile as Row;
    expect(profile).toMatchObject({ [`${kind}VerifiedAt`]: null, [`${kind}VerifiedDocumentChecksum`]: null, [`${kind}ExpiresAt`]: null });
    expect(profile[kind === "license" ? "insuranceVerifiedAt" : "licenseVerifiedAt"]).toBeInstanceOf(Date);
    if (kind === "insurance") expect(profile).toMatchObject({ insuranceCoverageCents: null, insuranceAdditionalInsured: false });
    expect(state.documents[0]).toMatchObject({ credentialReviewStatus: "pending" });
    expect(state.notifications[0]).toMatchObject({ kind: "account", dedupeKey: `credential-expired:${kind}-document-1:2026-11-07` });
    expect(state.batches[0].some((operation) => operation.model === "audit")).toBe(true);
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.notifications).toHaveLength(1);
  });

  it("ignores an old document after its current pointer was replaced", async () => {
    (state.documents[0].providerProfile as Row).licenseDocumentId = "replacement-2";
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.batches).toEqual([]); expect(state.notifications).toEqual([]);
  });

  it("removes approved-looking status from evidence for an edited claim without sending a renewal notice", async () => {
    (state.documents[0].providerProfile as Row).licenseNumber = "LIC-CHANGED";
    expect(await sweepProviderCredentialExpirations(NOW)).toEqual({ expired: 0, remindersQueued: 0 });
    expect(state.documents[0].credentialReviewStatus).toBe("pending");
    expect(state.notifications).toEqual([]);
  });

  it.each([[0, 1], [-100, 1], [10000, 500], [25, 25]])("bounds requested work %i to %i documents", async (limit, expected) => {
    state.documents = [];
    await sweepProviderCredentialExpirations(NOW, limit);
    expect(state.find).toHaveBeenCalledWith(expect.objectContaining({ take: expected }));
  });

  it("queries approved active credential documents with bounded 30/7-day and expired windows", async () => {
    state.documents = [];
    await sweepProviderCredentialExpirations(NOW);
    expect(state.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100, where: {
      purpose: { in: ["provider_license", "provider_insurance"] }, status: "active", credentialReviewStatus: "approved",
      OR: [
        { credentialExpiresAt: { lt: expiresIn(0) } },
        { credentialExpiresAt: { lte: expiresIn(30) }, credentialReminder30At: null },
        { credentialExpiresAt: { lte: expiresIn(7) }, credentialReminder7At: null },
      ],
    } }));
  });
});
