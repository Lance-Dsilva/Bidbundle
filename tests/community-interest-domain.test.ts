import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { communityInterest: { create: state.create, findMany: state.findMany, count: state.count } } }));
import { submitCommunityInterest, listCommunityInterest } from "@/lib/server/community-interest";
import { communityInterestSchema, communityInterestKey, communityInterestListQuerySchema } from "@/lib/validation/community-interest";
const input = { contactName: "Jane Smith", contactRole: "community_manager" as const, communityName: "Oakwood HOA", numberOfHomes: 75, email: "jane@example.invalid", phone: null };
beforeEach(() => { state.create.mockReset().mockResolvedValue({ id: "private-lead" }); state.findMany.mockReset().mockResolvedValue([]); state.count.mockReset().mockResolvedValue(0); });
describe("community interest persistence contract", () => {
  it("normalizes bounded contact data and a case/spacing/Unicode-stable duplicate key", async () => {
    const parsed = communityInterestSchema.parse({ ...input, contactName: " Jane\tSmith ", communityName: "  Ｏａｋｗｏｏｄ  HOA ", email: " JANE@EXAMPLE.INVALID ", phone: "  " });
    expect(parsed).toEqual(input); expect(communityInterestKey(parsed.communityName)).toBe("oakwood hoa"); await submitCommunityInterest(parsed);
    expect(state.create).toHaveBeenCalledWith({ data: { ...input, communityKey: "oakwood hoa" } });
  });
  it.each([
    { code: "P2002", meta: { modelName: "CommunityInterest", target: ["email", "communityKey"] } },
    { code: "P2002", meta: { target: "CommunityInterest_email_communityKey_key" } },
    { code: "P2002", meta: { modelName: "CommunityInterest", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["email", '"communityKey"'] } } } } },
    { code: "P2002", meta: { driverAdapterError: { cause: { constraint: { fields: ["email", "communityKey"] } } } } },
    { code: "23505", constraint: "CommunityInterest_email_communityKey_key" },
  ])("silently acknowledges only the intended unique duplicate: %j", async (error) => { state.create.mockRejectedValue(error); await expect(submitCommunityInterest(input)).resolves.toBeUndefined(); expect(state.create).toHaveBeenCalledOnce(); });
  it.each([
    { code: "P2002", meta: { modelName: "CommunityInterest", target: ["id"] } },
    { code: "P2002", meta: { modelName: "User", target: ["email", "communityKey"] } },
    { code: "P2002", meta: { target: ["email"] } },
    { code: "23505", constraint: "CommunityInterest_pkey" },
    { code: "P1001" }, new Error("Database unavailable"),
  ])("does not disguise another persistence failure as a received lead: %j", async (error) => { state.create.mockRejectedValue(error); await expect(submitCommunityInterest(input)).rejects.toBe(error); });
  it("uses bounded deterministic admin pagination and excludes internal dedupe metadata", async () => {
    state.findMany.mockResolvedValue([{ id: "lead", ...input, createdAt: new Date("2026-10-28T00:00:00Z") }]); state.count.mockResolvedValue(41);
    const result = await listCommunityInterest({ page: 3, pageSize: 20 }); expect(state.findMany).toHaveBeenCalledWith({ skip: 40, take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, contactName: true, contactRole: true, communityName: true, numberOfHomes: true, email: true, phone: true, createdAt: true } }); expect(result).toEqual({ items: [{ id: "lead", ...input, createdAt: "2026-10-28T00:00:00.000Z" }], total: 41, page: 3, pageSize: 20 });
  });
});
describe("community interest validation", () => {
  it.each([{ ...input, role: "admin" }, { ...input, userId: "target" }, { ...input, communityId: "target" }, { ...input, contactRole: "admin" }, { ...input, contactName: " " }, { ...input, contactName: "x".repeat(121) }, { ...input, communityName: "x".repeat(161) }, { ...input, numberOfHomes: 0 }, { ...input, numberOfHomes: 10_001 }, { ...input, numberOfHomes: 1.5 }, { ...input, email: "not an email" }])("rejects invalid input or authority injection: %j", (value) => { expect(communityInterestSchema.safeParse(value).success).toBe(false); });
  it("defaults omitted or blank phone to null and accepts contact roles only as metadata", () => { const withoutPhone: Partial<typeof input> = { ...input }; delete withoutPhone.phone; expect(communityInterestSchema.parse(withoutPhone).phone).toBeNull(); for (const contactRole of ["community_manager", "hoa_board", "property_manager", "resident", "other"]) expect(communityInterestSchema.parse({ ...input, contactRole }).contactRole).toBe(contactRole); });
  it("defaults admin list limits and refuses excessive/invalid pages", () => { expect(communityInterestListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 }); for (const value of [{ page: 0 }, { pageSize: 51 }, { page: 1.2 }, { page: 1_000_001 }, { role: "admin" }]) expect(communityInterestListQuerySchema.safeParse(value).success).toBe(false); });
  it("uses plain contact-role guidance instead of enum internals for an empty choice", () => {
    const result = communityInterestSchema.safeParse({ ...input, contactRole: "" }); expect(result.success).toBe(false);
    if (!result.success) { const message = result.error.issues.find((issue) => issue.path[0] === "contactRole")?.message ?? ""; expect(message).toMatch(/choose.*connection/i); expect(message).not.toMatch(/community_manager|hoa_board|property_manager|enum/i); }
  });
  it.each([NaN, 1.5, 0, 10001])("explains invalid home count in customer language: %s", (numberOfHomes) => {
    const result = communityInterestSchema.safeParse({ ...input, numberOfHomes }); expect(result.success).toBe(false);
    if (!result.success) { const message = result.error.issues.find((issue) => issue.path[0] === "numberOfHomes")?.message ?? ""; expect(message).toMatch(/homes|home/i); expect(message).not.toMatch(/NaN|invalid_type|too_big|too_small|expected/i); }
  });

});
