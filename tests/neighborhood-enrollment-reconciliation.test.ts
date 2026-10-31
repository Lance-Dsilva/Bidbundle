import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted Prisma promises model the observable transaction boundary: writes
// remain lazy until awaited, and a failed guarded claim rolls back the batch.
type Row = Record<string, unknown>;
type Op = { model: string; action: string; args: Row; then: PromiseLike<unknown>["then"] };
const state = vi.hoisted(() => ({
  rows: [] as Row[], providers: [] as Row[], committed: [] as Array<{ model: string; action: string; args: Row }>,
  finds: [] as Row[], updates: [] as Row[], transactions: 0,
  failNextTransaction: null as { code?: string; message: string } | null,
  beforeTransaction: null as (() => void | Promise<void>) | null,
  managerAllowed: false,
  failModel: null as string | null,
  failChildOnce: false,
  childError: null as Row | null,
  afterRollback: null as (() => void) | null,
}));

function matches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return actual instanceof Date && +actual === +expected;
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (Array.isArray(expected)) return expected.some((value) => matches(actual, value));
  const rule = expected as Row;
  if ("equals" in rule && !matches(actual, rule.equals)) return false;
  if ("not" in rule && matches(actual, rule.not)) return false;
  if ("lte" in rule && !(Number(actual) <= Number(rule.lte))) return false;
  if ("lt" in rule && !(Number(actual) < Number(rule.lt))) return false;
  if ("gte" in rule && !(Number(actual) >= Number(rule.gte))) return false;
  if ("gt" in rule && !(Number(actual) > Number(rule.gt))) return false;
  if ("in" in rule && !(rule.in as unknown[]).some((value) => matches(actual, value))) return false;
  const operators = new Set(["equals", "not", "lte", "lt", "gte", "gt", "in"]);
  return Object.entries(rule).every(([key, value]) => {
    if (operators.has(key)) return true;
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every((part) => matches(actual, part));
    if (key === "OR") return (value as unknown[]).some((part) => matches(actual, part));
    if (key === "NOT") return !(Array.isArray(value) ? value : [value]).some((part) => matches(actual, part));
    if (key === "none") return !(actual as unknown[]).some((part) => matches(part, value));
    if (key === "some") return (actual as unknown[]).some((part) => matches(part, value));
    if (key === "every") return (actual as unknown[]).every((part) => matches(part, value));
    if (key === "is") return matches(actual, value);
    return matches((actual as Row | null)?.[key], value);
  });
}

function execute(model: string, action: string, args: Row): unknown {
  if (state.failModel === model) throw { code: "P2002", message: "Injected write failure" };
  if (model === "hoaServiceRequest") {
    const selected = state.rows.filter((row) => matches(row, args.where));
    if (action === "update" && selected.length === 0) throw { code: "P2025", message: "Claim lost" };
    for (const row of selected) Object.assign(row, args.data);
    if (selected.length > 0) state.committed.push({ model, action, args });
    return action === "updateMany" ? { count: selected.length } : selected[0];
  }
  if (model === "hoaRequestParticipation") {
    if (state.childError) { const error = state.childError; state.childError = null; throw error; }
    if (state.failChildOnce) { state.failChildOnce = false; throw { code: "P2002" }; }
    const data = args.data as Row;
    if (action === "create") {
      const row = state.rows.find((row) => row.id === data.requestId)!;
      (row.participations as Row[]).push({ ...data });
    } else {
      for (const row of state.rows) for (const participation of row.participations as Row[]) {
        if (matches(participation, args.where)) Object.assign(participation, data);
      }
    }
  }
  state.committed.push({ model, action, args });
  return { id: "created" };
}

function plan(model: string, action: string, args: Row): Op {
  if (model === "hoaServiceRequest") state.updates.push(args);
  return {
    model, action, args,
    then(resolve, reject) { return Promise.resolve().then(() => execute(model, action, args)).then(resolve, reject); },
  };
}

vi.mock("@/lib/server/db", () => ({ db: {
  hoaServiceRequest: {
    findUnique: async (args: Row) => {
      const row = structuredClone(state.rows.find((row) => matches(row, args.where)) ?? null);
      const participationQuery = ((args.select as Row | undefined)?.participations as Row | undefined);
      if (row && participationQuery?.where) row.participations = (row.participations as Row[]).filter((part) => matches(part, participationQuery.where));
      return row;
    },
    findMany: async (args: Row) => {
      state.finds.push(args);
      const rows = state.rows.filter((row) => matches(row, args.where));
      for (const rule of [...(args.orderBy as Row[] ?? [])].reverse()) {
        const [key, direction] = Object.entries(rule)[0];
        rows.sort((a, b) => (a[key]! < b[key]! ? -1 : a[key]! > b[key]! ? 1 : 0) * (direction === "asc" ? 1 : -1));
      }
      return structuredClone(rows.slice(0, Number(args.take ?? Infinity)));
    },
    update: (args: Row) => plan("hoaServiceRequest", "update", args),
    updateMany: (args: Row) => plan("hoaServiceRequest", "updateMany", args),
  },
  community: { findUnique: async () => ({
    id: "hood-1", type: "neighborhood", status: "active", name: "Oakwood",
    centerLatitude: 30.4, centerLongitude: -97.72, hoaProfile: null,
  }) },
  providerProfile: { findMany: async (args: Row) => structuredClone(state.providers.filter((row) => matches(row, args.where))) },
  hoaRequestParticipation: {
    findFirst: async (args: Row) => structuredClone(state.rows.flatMap((row) => (row.participations as Row[]).map((part) => ({ ...part, requestId: row.id }))).find((part) => matches(part, args.where)) ?? null),
    count: async (args: Row) => state.rows.flatMap((row) => (row.participations as Row[]).map((part) => ({ ...part, requestId: row.id }))).filter((part) => matches(part, args.where)).length,
    create: (args: Row) => plan("hoaRequestParticipation", "create", args),
    update: (args: Row) => plan("hoaRequestParticipation", "update", args),
  },
  user: { findUnique: async () => ({ email: "resident@example.test", address: "1 Oak St", latitude: 30.4, longitude: -97.7 }) },
  adminAuditLog: { create: (args: Row) => plan("adminAuditLog", "create", args) },
  $transaction: async (ops: Op[]) => {
    state.transactions += 1;
    const before = state.beforeTransaction; state.beforeTransaction = null; await before?.();
    if (state.failNextTransaction) { const error = state.failNextTransaction; state.failNextTransaction = null; throw error; }
    const oldRows = structuredClone(state.rows); const oldWrites = state.committed.length;
    try { return ops.map((op) => execute(op.model, op.action, op.args)); }
    catch (error) {
      state.rows = oldRows; state.committed.splice(oldWrites);
      const after = state.afterRollback; state.afterRollback = null; after?.();
      throw error;
    }
  },
} }));

vi.mock("@/lib/server/notifications", () => ({
  buildPreferenceAwareNotificationOps: async (intents: Row[]) => intents.map((intent) => plan("notification", "create", { data: intent })),
  contentHash: () => "test-hash",
}));
vi.mock("@/lib/server/market-auth", () => ({
  requireCommunityManager: async () => {
    if (!state.managerAllowed) throw Object.assign(new Error("Not this community's manager"), { status: 403 });
    return { communityId: "hood-1", communityName: "Oakwood", via: "neighborhood_manager" };
  },
  findNeighborhoodManager: async () => null,
  requireActiveNeighborhoodMember: async () => undefined,
}));

import { reconcileNeighborhoodEnrollment, transitionHoaRequest } from "@/lib/server/hoa-market";
import { reconcileExpiredWindows, reconcileNeighborhoodEnrollments, respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";

const NOW = new Date("2026-10-27T12:00:00Z");
const WEEK = 7 * 86_400_000;
function request(overrides: Row = {}): Row {
  return {
    id: "request-1", communityId: "hood-1", createdByUserId: "resident-1",
    title: "Pressure washing", category: "cleaning", kind: "optional_group", status: "collecting_interest",
    enrollmentClosesAt: new Date(+NOW - 1), biddingClosesAt: null, participantsLockedAt: null,
    minHomes: 1, maxHomes: null, updatedAt: new Date(+NOW - 1000), community: { id: "hood-1", name: "Oakwood", type: "neighborhood", status: "active" },
    participations: [{ unitId: null, userId: "resident-1", response: "joined" }], agreement: null,
    ...overrides,
  };
}
function provider(overrides: Row = {}): Row {
  return {
    accountStatus: "active", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date(), trades: ["cleaning"], notifyNewJobs: true,
    user: { id: "provider-1", email: "provider@example.test", providerServiceAreas: [{
      centerLatitude: 30.4, centerLongitude: -97.72, radiusMiles: 15, postalCodes: [],
    }] }, ...overrides,
  };
}
function notifications() { return state.committed.filter((write) => write.model === "notification"); }
function audits() { return state.committed.filter((write) => write.model === "adminAuditLog"); }

beforeEach(() => {
  state.rows = [request()]; state.providers = [provider()]; state.committed = [];
  state.finds = []; state.updates = []; state.transactions = 0;
  state.failNextTransaction = null; state.beforeTransaction = null; state.managerAllowed = false;
  state.failModel = null;
  state.failChildOnce = false; state.afterRollback = null; state.childError = null;
});

describe("automatic neighborhood enrollment reconciliation", () => {
  it("opens a no-manager request after enrollment, locks it and notifies eligible providers", async () => {
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("opened");
    expect(state.rows[0]).toMatchObject({ status: "open_for_bids", participantsLockedAt: NOW, biddingClosesAt: new Date(+NOW + WEEK) });
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0].args.data).toMatchObject({ userId: "provider-1" });
    expect(audits().length).toBeGreaterThan(0);
    expect(audits().every((write) => !(write.args.data as Row).actor)).toBe(true);
    expect(JSON.stringify(audits())).toContain("deadline_reconciliation");
  });

  it("treats the exact enrollment deadline as elapsed", async () => {
    state.rows = [request({ enrollmentClosesAt: NOW })];
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("opened");
  });

  it.each([null, new Date(+NOW - 1), NOW])("provides a fresh seven-day window for a missing/stale bidding deadline (%s)", async (deadline) => {
    state.rows = [request({ biddingClosesAt: deadline })];
    await reconcileNeighborhoodEnrollment("request-1", NOW);
    expect(state.rows[0].biddingClosesAt).toEqual(new Date(+NOW + WEEK));
  });

  it("preserves a deliberately configured future bidding deadline", async () => {
    const deadline = new Date(+NOW + 10 * 86_400_000);
    state.rows = [request({ biddingClosesAt: deadline })];
    await reconcileNeighborhoodEnrollment("request-1", NOW);
    expect(state.rows[0].biddingClosesAt).toEqual(deadline);
  });

  it.each([
    { community: { id: "hood-1", name: "HOA", type: "hoa", status: "active" } },
    { community: { id: "hood-1", name: "Paused", type: "neighborhood", status: "inactive" } },
    { enrollmentClosesAt: new Date(+NOW + 1) }, { enrollmentClosesAt: null },
    { participantsLockedAt: new Date(+NOW - 2) }, { status: "cancelled" },
    { status: "open_for_bids" }, { kind: "compulsory_recurring" },
  ])("skips ineligible state without writes: %j", async (overrides) => {
    state.rows = [request(overrides)];
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("skipped");
    expect(state.committed).toEqual([]);
  });

  it("skips a missing request", async () => {
    state.rows = [];
    await expect(reconcileNeighborhoodEnrollment("missing", NOW)).resolves.toBe("skipped");
    expect(state.committed).toEqual([]);
  });

  it.each([
    { participations: [] },
    { minHomes: 2 },
    { participations: [{ unitId: null, userId: "resident-1", response: "declined" }] },
    { participations: [{ unitId: "unrelated-unit", userId: null, response: "joined" }] },
  ])("expires unmet enrollment with an audit and no provider notification: %j", async (overrides) => {
    state.rows = [request(overrides)];
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("failed");
    expect(state.rows[0].status).toBe("failed");
    expect(notifications()).toEqual([]);
    expect(audits().length).toBeGreaterThan(0);
    expect(JSON.stringify(audits())).toContain("reason");
  });

  it("is idempotent on repeated and competing worker claims", async () => {
    const results = await Promise.all([reconcileNeighborhoodEnrollment("request-1", NOW), reconcileNeighborhoodEnrollment("request-1", NOW)]);
    expect(results.sort()).toEqual(["opened", "skipped"]);
    expect(notifications()).toHaveLength(1);
    const firstAuditCount = audits().length;
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("skipped");
    expect(audits()).toHaveLength(firstAuditCount);
  });

  it("loses safely when a manager changes state between read and transaction", async () => {
    state.beforeTransaction = () => { state.rows[0].status = "open_for_bids"; };
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("skipped");
    expect(state.committed).toEqual([]);
    expect(state.rows[0].status).toBe("open_for_bids");
  });

  it("does not swallow operational transaction failures", async () => {
    state.failNextTransaction = { code: "P1001", message: "Database unavailable" };
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).rejects.toMatchObject({ code: "P1001" });
    expect(state.committed).toEqual([]);
    expect(state.rows[0].status).toBe("collecting_interest");
  });

  it.each(["adminAuditLog", "notification"])("rolls back the claim when %s writes fail", async (model) => {
    state.failModel = model;
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).rejects.toMatchObject({ code: "P2002" });
    expect(state.rows[0]).toMatchObject({ status: "collecting_interest", participantsLockedAt: null, biddingClosesAt: null });
    expect(state.committed).toEqual([]);
  });

  it.each(["cancel", "pause", "extend", "minimum"])("guards a concurrent %s before committing effects", async (change) => {
    state.beforeTransaction = () => {
      if (change === "cancel") state.rows[0].status = "cancelled";
      if (change === "pause") (state.rows[0].community as Row).status = "inactive";
      if (change === "extend") state.rows[0].enrollmentClosesAt = new Date(+NOW + WEEK);
      if (change === "minimum") state.rows[0].minHomes = 2;
    };
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("skipped");
    expect(state.committed).toEqual([]);
  });

  it("reports a manual manager's lost claim as a conflict", async () => {
    state.managerAllowed = true;
    state.beforeTransaction = () => { state.rows[0].status = "cancelled"; };
    await expect(transitionHoaRequest("manager-1", "request-1", {
      action: "open_bidding", biddingClosesAt: new Date(Date.now() + WEEK).toISOString(),
    })).rejects.toMatchObject({ status: 409 });
    expect(state.committed).toEqual([]);
  });

  it.each(["unlicensed", "uninsured", "suspended", "wrong-trade", "uncovered"])("keeps provider eligibility filtering: %s", async (reason) => {
    if (reason === "unlicensed") state.providers = [provider({ licenseVerifiedAt: null })];
    if (reason === "uninsured") state.providers = [provider({ insuranceVerifiedAt: null })];
    if (reason === "suspended") state.providers = [provider({ accountStatus: "suspended" })];
    if (reason === "wrong-trade") state.providers = [provider({ trades: ["plumbing"] })];
    if (reason === "uncovered") state.providers = [provider({ user: { id: "far", email: "far@example.test", providerServiceAreas: [{ centerLatitude: 40, centerLongitude: -100, radiusMiles: 1, postalCodes: [] }] } })];
    await reconcileNeighborhoodEnrollment("request-1", NOW);
    expect(state.rows[0].status).toBe("open_for_bids");
    expect(notifications()).toEqual([]);
  });

  it("does not grant a resident permission to manually open bidding", async () => {
    await expect(transitionHoaRequest("resident-1", "request-1", { action: "open_bidding", biddingClosesAt: new Date(+NOW + WEEK).toISOString() })).rejects.toMatchObject({ status: 403 });
    expect(state.committed).toEqual([]);
  });

  it.each(["joined", "declined"])("rejects a stale participant snapshot after a concurrent %s response", async (response) => {
    state.beforeTransaction = () => {
      if (response === "joined") (state.rows[0].participations as Row[]).push({ userId: "resident-2", unitId: null, response });
      else (state.rows[0].participations as Row[])[0].response = response;
    };
    await expect(reconcileNeighborhoodEnrollment("request-1", NOW)).resolves.toBe("skipped");
    expect(state.committed).toEqual([]);
  });
});

describe("bounded deadline sweep", () => {
  it("keeps frequent worker reconciliation isolated from HOA, old bid deadlines and inactive neighborhoods", async () => {
    state.rows = [request(), request({ id: "empty-hood", participations: [] }), request({ id: "old-bid", status: "open_for_bids", biddingClosesAt: new Date(+NOW - 1) }), request({ id: "empty-hoa", community: { type: "hoa", status: "active" }, participations: [] }), request({ id: "inactive", community: { type: "neighborhood", status: "inactive" } })];
    await expect(reconcileNeighborhoodEnrollments(NOW)).resolves.toEqual({ biddingOpened: 1, enrollmentExpired: 1 });
    expect(state.rows.find((row) => row.id === "old-bid")?.status).toBe("open_for_bids");
    expect(state.rows.find((row) => row.id === "empty-hoa")?.status).toBe("collecting_interest");
    expect(state.rows.find((row) => row.id === "inactive")?.status).toBe("collecting_interest");
    const emptyAudit = audits().filter((write) => (write.args.data as Row).targetId === "empty-hood");
    expect(emptyAudit).toHaveLength(1);
    expect((emptyAudit[0].args.data as Row).metadata).toMatchObject({ reason: "insufficient_joined_homes" });
    expect(state.updates.every((args) => (args.where as Row).id)).toBe(true);
  });
  it("opens expired neighborhood enrollment while preserving close/empty-rollback behavior", async () => {
    state.rows = [request(), request({ id: "closed-bid", status: "open_for_bids", biddingClosesAt: new Date(+NOW - 1) }), request({ id: "empty-hoa", community: { id: "hoa-1", type: "hoa", status: "active" }, participations: [] })];
    const result = await reconcileExpiredWindows(NOW);
    expect(result).toMatchObject({ biddingOpened: 1, biddingClosed: 1, enrollmentExpired: 1 });
    expect(state.rows.find((row) => row.id === "empty-hoa")?.status).toBe("failed");
    const query = state.finds[0];
    expect(Number(query.take)).toBeGreaterThan(0);
    expect(Number(query.take)).toBeLessThanOrEqual(100);
    expect(query.orderBy).toBeDefined();
    expect(query.where).toMatchObject({ community: { type: "neighborhood", status: "active" }, kind: "optional_group", status: "collecting_interest", participantsLockedAt: null });
    expect(query.orderBy).toEqual([{ enrollmentClosesAt: "asc" }, { id: "asc" }]);
  });

  it("processes only 100 ordered candidates then completes the remainder without repeated notifications", async () => {
    state.rows = Array.from({ length: 101 }, (_, index) => request({ id: `request-${String(index).padStart(3, "0")}` })).reverse();
    await expect(reconcileExpiredWindows(NOW)).resolves.toMatchObject({ biddingOpened: 100 });
    expect(state.rows.find((row) => row.id === "request-100")?.status).toBe("collecting_interest");
    expect(notifications()).toHaveLength(100);
    await expect(reconcileExpiredWindows(NOW)).resolves.toMatchObject({ biddingOpened: 1 });
    expect(notifications()).toHaveLength(101);
    await expect(reconcileExpiredWindows(NOW)).resolves.toMatchObject({ biddingOpened: 0 });
    expect(notifications()).toHaveLength(101);
    expect(state.rows.every((row) => row.status === "open_for_bids" && !row.awardedAt)).toBe(true);
  });
});

describe("serialized neighborhood responses", () => {
  it.each([
    { code: "23514", constraint: "HoaRequestParticipation_enrollment_open_required" },
    { code: "23514", constraint: "HoaRequestParticipation_locked" },
    { code: "P2004", meta: { database_error: "HoaRequestParticipation_enrollment_open_required" } },
    { code: "P2004", meta: { driverAdapterError: { cause: { originalCode: "23514", detail: "HoaRequestParticipation_locked" } } } },
    { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "23514", detail: "HoaRequestParticipation_enrollment_open_required" } } } },
  ])("returns a refresh conflict when the database catches an enrollment race (%j)", async (error) => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK) })];
    state.childError = error;
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).rejects.toMatchObject({ status: 409 });
    expect(state.committed).toEqual([]);
    expect(state.rows[0].updatedAt).toEqual(new Date(+NOW - 1000));
  });

  it.each([
    { code: "P2004", meta: { database_error: 'constraint "HoaRequestParticipation_active_member_required"' } },
    { code: "23514", constraint: "HoaRequestParticipation_neighborhood_resident_required" },
    { code: "P2004", message: "unknown database constraint failure" },
    { code: "P1001", message: "database unavailable" },
    { code: "XX000", constraint: "HoaRequestParticipation_locked", message: "internal database failure" },
    { code: "P2004", meta: { database_error: 'new row violates check constraint "HoaRequestParticipation_enrollment_open_required"' } },
    { code: "P2004", meta: { driverAdapterError: { cause: { originalCode: "23514", originalMessage: 'constraint "HoaRequestParticipation_locked"' } } } },
    { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "23514", detail: "HoaRequestParticipation_active_member_required" } } } },
    { code: "P2004", meta: { detail: "HoaRequestParticipation_locked_extra" } },
  ])("preserves unrelated database failures (%j)", async (error) => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK) })];
    state.childError = error;
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).rejects.toBe(error);
    expect(state.committed).toEqual([]);
  });

  it("rejects a new home at capacity without touching the parent or child", async () => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK), maxHomes: 1 })];
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).rejects.toThrow(/maximum/);
    expect(state.committed).toEqual([]);
  });

  it("rereads after a duplicate insert and applies the answer to the winning row", async () => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK) })];
    state.failChildOnce = true;
    state.afterRollback = () => { (state.rows[0].participations as Row[]).push({ id: "competing-row", userId: "resident-2", unitId: null, response: "declined" }); };
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).resolves.toMatchObject({ response: "joined", joinedCount: 2 });
    const participantWrites = state.committed.filter((write) => write.model === "hoaRequestParticipation");
    expect(participantWrites).toHaveLength(1);
    expect(participantWrites[0]).toMatchObject({ action: "update", args: { where: { id: "competing-row" } } });
    expect(state.transactions).toBeGreaterThanOrEqual(2);
  });

  it("revalidates closure after a duplicate insertion instead of writing a late answer", async () => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK) })];
    state.failChildOnce = true;
    state.afterRollback = () => { state.rows[0].status = "open_for_bids"; state.rows[0].participantsLockedAt = new Date(); };
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).rejects.toThrow(/no longer open/);
    expect(state.committed).toEqual([]);
  });
  it("makes a stale opener skip after a response wins the parent claim", async () => {
    const now = Date.now();
    state.rows = [request({ updatedAt: new Date(now), enrollmentClosesAt: new Date(now + 10000) })];
    state.beforeTransaction = async () => {
      await respondToNeighborhoodRequest("resident-2", "request-1", "declined");
    };
    await expect(reconcileNeighborhoodEnrollment("request-1", new Date(now + 10001))).resolves.toBe("skipped");
    expect(state.rows[0].status).toBe("collecting_interest");
    expect(Number(state.rows[0].updatedAt)).toBeGreaterThan(now);
    expect((state.rows[0].participations as Row[]).some((part) => part.userId === "resident-2" && part.response === "declined")).toBe(true);
    expect(audits()).toEqual([]);
  });

  it("rejects a late response without child writes after opening wins the parent claim", async () => {
    const now = Date.now();
    state.rows = [request({ updatedAt: new Date(now), enrollmentClosesAt: new Date(now + 10000) })];
    state.beforeTransaction = async () => {
      await expect(reconcileNeighborhoodEnrollment("request-1", new Date(now + 10001))).resolves.toBe("opened");
    };
    await expect(respondToNeighborhoodRequest("resident-2", "request-1", "joined")).rejects.toMatchObject({ status: 409 });
    expect(state.rows[0].status).toBe("open_for_bids");
    expect(state.committed.filter((write) => write.model === "hoaRequestParticipation")).toEqual([]);
    expect(notifications()).toHaveLength(1);
  });

  it("makes repeating an existing answer a write-free operation", async () => {
    state.rows = [request({ enrollmentClosesAt: new Date(Date.now() + WEEK) })];
    await expect(respondToNeighborhoodRequest("resident-1", "request-1", "joined")).resolves.toEqual({ response: "joined", joinedCount: 1 });
    expect(state.committed).toEqual([]);
  });
});
