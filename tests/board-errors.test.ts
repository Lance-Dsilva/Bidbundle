import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { boardReviewRound: { findUnique: state.find }, $transaction: state.transaction } }));
vi.mock("@/lib/server/hoa", () => ({ HoaWorkflowError: class extends Error { constructor(message: string, readonly status = 400) { super(message); } } }));
import { boardWorkflowError, resolveBoardReminder } from "@/lib/server/board-review";

beforeEach(() => {
  vi.resetAllMocks();
  state.find.mockResolvedValue({ requestId: "request", communityId: "community" });
});

describe("board database failure boundaries", () => {
  it.each([
    { code: "P1761" },
    { code: "P2010", meta: { code: "P1761", message: "private database detail" } },
    { meta: { driverAdapterError: { cause: { originalCode: "P1761" } } } },
    Object.assign(new Error("private database detail"), { cause: { code: "P1761" } }),
  ])("maps supported driver access codes without exposing database messages", error => {
    const mapped = boardWorkflowError(error);
    expect(mapped).toMatchObject({ status: 403 });
    expect(mapped?.message).not.toContain("private database detail");
  });
  it("maps board state failures and preserves unrelated existing workflow codes", () => {
    expect(boardWorkflowError({ code: "P2010", meta: { code: "P1762" } })).toMatchObject({ status: 409 });
    expect(boardWorkflowError({ code: "P2010", meta: { code: "P1702" } })).toBeNull();
  });
  it("does not turn error text into authorization or terminal-state evidence", () => {
    expect(boardWorkflowError(new Error("Network failure while handling user text P1762"))).toBeNull();
    expect(boardWorkflowError({ code: "ECONNRESET", meta: { message: "P1761" } })).toBeNull();
    const circular: { code: string; cause?: unknown } = { code: "ECONNRESET" }; circular.cause = circular;
    expect(boardWorkflowError(circular)).toBeNull();
  });
  it("keeps infrastructure failures retryable in the reminder worker", async () => {
    const outage = Object.assign(new Error("Database unavailable"), { code: "ECONNRESET" });
    state.transaction.mockRejectedValue(outage);
    await expect(resolveBoardReminder({ roundId: "round", userId: "member" })).rejects.toBe(outage);
  });
  it.each(["P1761", "P1762"])("skips a terminal reminder after SQL code %s", async code => {
    state.transaction.mockRejectedValue({ code: "P2010", meta: { code } });
    await expect(resolveBoardReminder({ roundId: "round", userId: "member" })).resolves.toEqual({ kind: "skipped" });
  });
});
