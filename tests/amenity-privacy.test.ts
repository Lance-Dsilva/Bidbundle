import { describe, expect, it } from "vitest";

import { canViewMedia, sniffImageType, type MediaAccess } from "@/lib/server/media";
import { serializeIssue } from "@/lib/server/amenity-issues";

/**
 * The two places a leak would actually happen.
 *
 * 1. **Issue serialization.** A manager's internal note lives in the same
 *    thread as the replies the resident reads. The only thing standing between
 *    them is `serializeIssue`'s audience argument, so it is tested directly
 *    rather than through a route that might one day call it differently.
 *
 * 2. **Media authorization.** Gallery photos, review photos, and complaint
 *    attachments have three different audiences. A single "same community"
 *    check would let a neighbour page through their neighbours' complaints.
 */

const BASE_ISSUE = {
  id: "issue-1",
  reference: "AI-ABC123",
  communityId: "hoa-1",
  amenityId: "amenity-1",
  reporterUserId: "user-reporter",
  bookingId: null,
  category: "damage" as const,
  priority: "normal" as const,
  status: "acknowledged" as const,
  subject: "Broken net",
  description: "The badminton net is torn.",
  assignedToUserId: null,
  resolutionSummary: null,
  resolvedAt: null,
  closedAt: null,
  withdrawnAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  amenity: { id: "amenity-1", name: "Badminton Court" },
  reporter: { id: "user-reporter", fullName: "Rae" },
  assignedTo: null,
  media: [{ id: "media-1", width: 800, height: 600, status: "active" }],
  events: [],
  messages: [
    {
      id: "msg-1",
      issueId: "issue-1",
      authorUserId: "user-reporter",
      kind: "resident_message" as const,
      body: "It happened on Tuesday.",
      createdAt: new Date("2026-06-01T01:00:00Z"),
      author: { id: "user-reporter", fullName: "Rae" },
    },
    {
      id: "msg-2",
      issueId: "issue-1",
      authorUserId: "user-manager",
      kind: "manager_reply" as const,
      body: "Thanks, we've ordered a replacement.",
      createdAt: new Date("2026-06-01T02:00:00Z"),
      author: { id: "user-manager", fullName: "Morgan" },
    },
    {
      id: "msg-3",
      issueId: "issue-1",
      authorUserId: "user-manager",
      kind: "internal_note" as const,
      body: "Third complaint this quarter — escalate to the board.",
      createdAt: new Date("2026-06-01T03:00:00Z"),
      author: { id: "user-manager", fullName: "Morgan" },
    },
  ],
} as never;

describe("issue thread visibility", () => {
  it("never puts an internal note in the reporter's payload", () => {
    const view = serializeIssue(BASE_ISSUE, "user-reporter", "reporter");

    expect(view.messages).toHaveLength(2);
    expect(view.messages.map((message) => message.kind)).toEqual([
      "resident_message",
      "manager_reply",
    ]);

    // The note is absent from the serialized object entirely — not merely
    // flagged for the client to hide.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("escalate to the board");
    expect(serialized).not.toContain("internal_note");
  });

  it("shows staff the whole thread, note included", () => {
    const view = serializeIssue(BASE_ISSUE, "user-manager", "staff");

    expect(view.messages).toHaveLength(3);
    expect(view.messages.at(-1)).toMatchObject({
      kind: "internal_note",
      isMine: true,
    });
  });

  it("marks the reporter's own messages and offers withdrawal only to them", () => {
    const reporterView = serializeIssue(BASE_ISSUE, "user-reporter", "reporter");
    expect(reporterView.messages[0].isMine).toBe(true);
    expect(reporterView.canWithdraw).toBe(true);

    const staffView = serializeIssue(BASE_ISSUE, "user-manager", "staff");
    expect(staffView.canWithdraw).toBe(false);
    expect(staffView.canReopen).toBe(false);
  });

  it("offers reopen, not withdrawal, once a report is resolved", () => {
    const resolved = { ...(BASE_ISSUE as object), status: "resolved" } as never;
    const view = serializeIssue(resolved, "user-reporter", "reporter");
    expect(view.canWithdraw).toBe(false);
    expect(view.canReopen).toBe(true);
  });

  it("references photos by an authorized path, never a storage URL", () => {
    const view = serializeIssue(BASE_ISSUE, "user-reporter", "reporter");
    expect(view.photos).toEqual([
      {
        id: "media-1",
        url: "/api/hoa/amenities/media/media-1",
        width: 800,
        height: 600,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("blob.vercel-storage.com");
  });
});

function asset(overrides: Partial<MediaAccess> = {}): MediaAccess {
  return {
    communityId: "hoa-1",
    purpose: "amenity_gallery",
    amenityId: "amenity-1",
    reviewId: null,
    issueId: null,
    issueReporterUserId: null,
    reviewStatus: null,
    amenityStatus: "published",
    contentType: "image/jpeg",
    storageUrl: "https://blob.example/abc",
    ...overrides,
  };
}

const RESIDENT = { communityId: "hoa-1", userId: "user-resident", canManage: false };
const REPORTER = { communityId: "hoa-1", userId: "user-reporter", canManage: false };
const STAFF = { communityId: "hoa-1", userId: "user-manager", canManage: true };
const OUTSIDER = { communityId: "hoa-2", userId: "user-outsider", canManage: false };

describe("media visibility", () => {
  it("lets any authorized resident of the HOA see a published gallery photo", () => {
    expect(canViewMedia(asset(), RESIDENT)).toBe(true);
  });

  it("refuses a resident of a different HOA outright", () => {
    expect(canViewMedia(asset(), OUTSIDER)).toBe(false);
  });

  it("keeps a draft amenity's photos to staff", () => {
    const draft = asset({ amenityStatus: "draft" });
    expect(canViewMedia(draft, RESIDENT)).toBe(false);
    expect(canViewMedia(draft, STAFF)).toBe(true);
  });

  it("restricts a complaint attachment to the reporter and staff", () => {
    const attachment = asset({
      purpose: "amenity_issue",
      amenityId: null,
      issueId: "issue-1",
      issueReporterUserId: "user-reporter",
      amenityStatus: null,
    });

    expect(canViewMedia(attachment, REPORTER)).toBe(true);
    expect(canViewMedia(attachment, STAFF)).toBe(true);
    // The neighbour is an active member of the same HOA and still cannot read
    // it. This is the case a plain tenant check would get wrong.
    expect(canViewMedia(attachment, RESIDENT)).toBe(false);
    expect(canViewMedia(attachment, OUTSIDER)).toBe(false);
  });

  it("hides a removed review's photos from residents but not from staff", () => {
    const removed = asset({
      purpose: "amenity_review",
      amenityId: null,
      reviewId: "review-1",
      reviewStatus: "removed",
    });

    expect(canViewMedia(removed, RESIDENT)).toBe(false);
    expect(canViewMedia(removed, STAFF)).toBe(true);
  });

  it("shows a published review's photos to residents", () => {
    const published = asset({
      purpose: "amenity_review",
      amenityId: null,
      reviewId: "review-1",
      reviewStatus: "published",
      amenityStatus: "published",
    });
    expect(canViewMedia(published, RESIDENT)).toBe(true);
  });
});

describe("image type sniffing", () => {
  it("identifies the three supported formats from their magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(
      sniffImageType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe("image/webp");
  });

  it("rejects content whose bytes disagree with any supported format", () => {
    // An HTML payload named `photo.png` with `Content-Type: image/png`. Both
    // labels are attacker-chosen; only the bytes are not.
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(sniffImageType(html)).toBeNull();

    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // truncated JPEG
  });

  it("does not accept a RIFF container that is not WebP", () => {
    // RIFF....WAVE — a sound file wearing an image's first four bytes.
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });
});
