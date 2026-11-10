import { describe, expect, it, vi } from "vitest";

import { canViewMedia, type MediaAccess } from "@/lib/server/media";
import { MAX_REVIEW_COMMENT_LENGTH, reviewCreateSchema } from "@/lib/validation/hoa";

const state = vi.hoisted(() => ({ expanded: false, put: vi.fn(), del: vi.fn(), get: vi.fn(), create: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: state.put, del: state.del, get: state.get }));
vi.mock("@/lib/server/db", () => ({ db: {
  user: { findUnique: async () => ({ id: "provider", role: "provider", isVerified: true, email: "provider@example.invalid", providerProfile: { accountStatus: "active" } }) },
  serviceVisit: { findUnique: async () => ({ id: "visit", status: "scheduled", updatedAt: new Date(), unitId: "unit", homeownerUserId: null,
    occurrence: { agreement: { providerUserId: "provider", communityId: "hoa", status: "active", community: { status: "active", type: "hoa" } } } }) },
  communityMembership: { findFirst: async () => null }, communityStaffAssignment: { findFirst: async () => null },
  mediaAsset: { count: async () => 0, create: state.create },
} }));
vi.mock("@/lib/server/media", async importActual => {
  const actual = await importActual<typeof import("@/lib/server/media")>();
  return { ...actual, normalizeUpload: async (...args: Parameters<typeof actual.normalizeUpload>) => state.expanded ? {
    ok: true, image: { bytes: Buffer.alloc(4 * 1024 * 1024 + 1), contentType: "image/png", extension: "png", width: 1, height: 1, checksum: "a".repeat(64) },
  } : actual.normalizeUpload(...args) };
});

import { readVisitPhotoForm, storeVisitPhoto } from "@/lib/server/visit-photos";
import { buildVisitReviewPromptData, VISIT_REVIEW_DELAY_MS } from "@/lib/server/visit-review-prompts";

/** A private file must not gain access through an unrelated media endpoint. */
const amenityAsset: MediaAccess = {
  communityId: "same-community",
  purpose: "amenity_gallery",
  amenityId: "amenity",
  reviewId: null,
  issueId: null,
  issueReporterUserId: null,
  reviewStatus: null,
  amenityStatus: "published",
  contentType: "image/jpeg",
  storageUrl: "https://example.invalid/never-return-this",
};

describe("visit proof cannot inherit amenity media access", () => {
  it.each(["visit_before", "visit_after", "provider_license", "provider_insurance", "unknown"])(
    "rejects %s even for same-community amenity managers",
    (purpose) => {
      // The database enum is intentionally wider than this amenity-only DTO.
      // Test the runtime guard against a malicious/cross-purpose caller.
      const privateAsset = { ...amenityAsset, purpose } as unknown as MediaAccess;
      expect(canViewMedia(privateAsset, { communityId: "same-community", userId: "manager", canManage: true })).toBe(false);
      expect(canViewMedia(privateAsset, { communityId: "same-community", userId: "resident", canManage: false })).toBe(false);
    },
  );

  it("preserves legitimate published amenity gallery and complaint privacy", () => {
    expect(canViewMedia(amenityAsset, { communityId: "same-community", userId: "resident", canManage: false })).toBe(true);
    const complaint: MediaAccess = { ...amenityAsset, purpose: "amenity_issue", amenityId: null,
      issueId: "private-complaint", issueReporterUserId: "reporter" };
    expect(canViewMedia(complaint, { communityId: "same-community", userId: "neighbor", canManage: false })).toBe(false);
    expect(canViewMedia(complaint, { communityId: "same-community", userId: "reporter", canManage: false })).toBe(true);
  });
});

describe("resident visit rating accepts an optional comment", () => {
  it.each([{ rating: 5 }, { rating: 4, comment: "" }, { rating: 3, comment: "  " }])(
    "accepts rating-only feedback %j",
    (input) => {
      const result = reviewCreateSchema.parse(input);
      expect(result.rating).toBe(input.rating);
      expect(result.comment ?? "").toBe("");
    },
  );

  it("trims optional comment text without publishing surrounding whitespace", () => {
    expect(reviewCreateSchema.parse({ rating: 5, comment: "  Careful work, thank you.  " })).toEqual({ rating: 5, comment: "Careful work, thank you." });
  });

  it.each([0, 6, 1.5, Number.NaN, Infinity, "5", null])("refuses invalid rating %s", (rating) => {
    expect(reviewCreateSchema.safeParse({ rating }).success).toBe(false);
  });

  it("retains the comment bound and refuses client-controlled publication or provider identity", () => {
    expect(reviewCreateSchema.safeParse({ rating: 5, comment: "a".repeat(MAX_REVIEW_COMMENT_LENGTH) }).success).toBe(true);
    expect(reviewCreateSchema.safeParse({ rating: 5, comment: "a".repeat(MAX_REVIEW_COMMENT_LENGTH + 1) }).success).toBe(false);
    expect(reviewCreateSchema.safeParse({ rating: 5, status: "published", providerUserId: "attacker" }).success).toBe(false);
  });
});


describe("visit upload resource and delayed prompt boundaries", () => {
  it("rejects a small image whose decoded/normalized bytes exceed the independent 4 MiB output limit", async () => {
    const previous = process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN;
    process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN = "synthetic-unit-private-token";
    state.expanded = true; state.put.mockClear(); state.create.mockClear();
    try {
      const smallInput = new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: "image/png" });
      await expect(storeVisitPhoto("provider", "visit", "visit_after", smallInput)).rejects.toMatchObject({ status: 413 });
      expect(state.put).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
    } finally {
      state.expanded = false;
      if (previous === undefined) delete process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN; else process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN = previous;
    }
  });

  it("requires multipart data and bounds the stream including envelope overhead", async () => {
    await expect(readVisitPhotoForm(new Request("https://example.invalid", { method: "POST", body: "not multipart" }))).rejects.toMatchObject({ status: 415 });
    let cancelled = false;
    const request = new Request("https://example.invalid", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 65537)); }, cancel() { cancelled = true; } }),
      duplex: "half",
    } as RequestInit);
    await expect(readVisitPhotoForm(request)).rejects.toMatchObject({ status: 413 }); expect(cancelled).toBe(true);
  });

  it("freezes only opaque visit and recipient identities and persists an exact two-hour due time", () => {
    const completedAt = new Date("2026-11-10T23:59:59.001Z");
    const one = buildVisitReviewPromptData("visit", completedAt, "resident-at-completion");
    const retry = buildVisitReviewPromptData("visit", completedAt, "resident-at-completion");
    expect(one).toMatchObject({ kind: "visit_review_prompt", dedupeKey: "visit-review-prompt:visit", payload: { visitId: "visit", recipientUserId: "resident-at-completion" } });
    expect(+one.nextAttemptAt - +completedAt).toBe(VISIT_REVIEW_DELAY_MS);
    expect(one.dedupeKey).toBe(retry.dedupeKey);
    expect(Object.keys(one.payload).sort()).toEqual(["recipientUserId", "visitId"]);
    expect(JSON.stringify(one.payload)).not.toMatch(/email|address|storage|photo/i);
  });
});
