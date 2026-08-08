import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAvatarPath,
  inspectAvatarUpload,
  isOwnedAvatarPath,
  sniffImageType,
} from "@/lib/server/avatar";
import { MAX_AVATAR_BYTES } from "@/lib/validation/profile";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function withHeader(header: number[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(header, 0);
  return bytes;
}

const JPEG = () => withHeader([0xff, 0xd8, 0xff, 0xe0], 64);
const PNG = () => withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
const WEBP = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return bytes;
};

function fileOf(bytes: Uint8Array, type: string, name = "avatar.png"): File {
  return new File([bytes], name, { type });
}

/* ── Type sniffing ───────────────────────────────────────────────────────── */

describe("sniffImageType", () => {
  it.each([
    ["image/jpeg", JPEG()],
    ["image/png", PNG()],
    ["image/webp", WEBP()],
  ])("identifies %s from its magic bytes", (expected, bytes) => {
    expect(sniffImageType(bytes)).toBe(expected);
  });

  it("rejects a payload whose bytes are not an image", () => {
    expect(sniffImageType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
  });

  it("rejects an SVG, which is script-capable markup rather than a raster image", () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />'))).toBeNull();
  });

  it("rejects a truncated signature", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

/* ── Upload inspection ───────────────────────────────────────────────────── */

describe("inspectAvatarUpload", () => {
  it("accepts a real PNG and reports its extension", async () => {
    const result = await inspectAvatarUpload(fileOf(PNG(), "image/png"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/png");
      expect(result.extension).toBe("png");
    }
  });

  it("believes the bytes, not the declared Content-Type", async () => {
    // A JPEG announced as a PNG is stored as the JPEG it actually is.
    const result = await inspectAvatarUpload(fileOf(JPEG(), "image/png", "sneaky.png"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentType).toBe("image/jpeg");
  });

  it("rejects HTML wearing an image Content-Type", async () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    const result = await inspectAvatarUpload(fileOf(html, "image/png", "payload.png"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("unsupported-type");
  });

  it("rejects a file over the size ceiling", async () => {
    const oversized = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_AVATAR_BYTES + 1);
    const result = await inspectAvatarUpload(fileOf(oversized, "image/png"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("too-large");
  });

  it("accepts a file exactly at the ceiling", async () => {
    const atLimit = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_AVATAR_BYTES);
    const result = await inspectAvatarUpload(fileOf(atLimit, "image/png"));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a missing field", null],
    ["a text field instead of a file", "not-a-file"],
    ["an empty file", new File([], "empty.png", { type: "image/png" })],
  ])("rejects %s", async (_label, value) => {
    const result = await inspectAvatarUpload(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("missing");
  });
});

/* ── Ownership ───────────────────────────────────────────────────────────── */

describe("avatar paths", () => {
  it("scopes the stored object to the owning user", () => {
    const path = buildAvatarPath("user_1", "png", "abc");
    expect(path).toBe("avatars/user_1/abc.png");
    expect(isOwnedAvatarPath(path, "user_1")).toBe(true);
  });

  it("does not treat another user's object as owned", () => {
    expect(isOwnedAvatarPath("avatars/user_2/abc.png", "user_1")).toBe(false);
  });

  it.each([
    "avatars/user_10/abc.png",
    "avatars/../user_1/abc.png",
    "/avatars/user_1/abc.png",
    "other/user_1/abc.png",
  ])("does not accept %s as belonging to user_1", (path) => {
    expect(isOwnedAvatarPath(path, "user_1")).toBe(false);
  });
});

/* ── Route handler ───────────────────────────────────────────────────────── */

const state = vi.hoisted(() => ({
  clerkUserId: "clerk_1" as string | null,
  blobToken: "vercel_blob_rw_test" as string | undefined,
  previousPath: null as string | null,
  put: [] as Array<{ path: string; contentType?: string }>,
  del: [] as string[],
  deleteFailure: false,
  guardFailure: null as null | { kind: "rate-limited"; retryAfterSeconds: number } | { kind: "unavailable" },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

vi.mock("@/lib/server/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth-guard")>();
  return { ...actual, guardAvatarUpload: async () => state.guardFailure };
});

vi.mock("@vercel/blob", () => ({
  put: async (path: string, _body: unknown, options: { contentType?: string }) => {
    state.put.push({ path, contentType: options.contentType });
    return { url: `https://blob.example/${path}` };
  },
  del: async (path: string) => {
    if (state.deleteFailure) throw new Error("Blob unavailable");
    state.del.push(path);
  },
}));

const blobClient = {
  user: {
    findUnique: async (args: { select?: Record<string, unknown> }) => {
      if (args.select && "clerkUserId" in args.select) {
        return {
          id: "user_1",
          clerkUserId: state.clerkUserId,
          email: "ada@example.com",
          fullName: "Ada Lovelace",
          role: "homeowner",
          isVerified: true,
        };
      }
      return { avatarPath: state.previousPath };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      state.updates.push(args.data);
      return {};
    },
  },
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(blobClient),
};

vi.mock("@/lib/server/db", () => ({ db: blobClient }));

const avatarRoute = await import("@/app/api/profile/avatar/route");

function uploadRequest(file: File | null): Request {
  const body = new FormData();
  if (file) body.append("file", file);
  return new Request("https://bundleen.test/api/profile/avatar", { method: "POST", body });
}

beforeEach(() => {
  state.clerkUserId = "clerk_1";
  state.blobToken = "vercel_blob_rw_test";
  state.previousPath = null;
  state.put = [];
  state.del = [];
  state.deleteFailure = false;
  state.guardFailure = null;
  state.updates = [];
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", state.blobToken);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/profile/avatar", () => {
  it("stores the image under the caller's own id and saves only its metadata", async () => {
    const response = await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(response.status).toBe(200);

    expect(state.put[0].path.startsWith("avatars/user_1/")).toBe(true);
    expect(state.put[0].contentType).toBe("image/png");

    const saved = state.updates[0];
    expect(saved.avatarUrl).toBe(`https://blob.example/${state.put[0].path}`);
    expect(JSON.stringify(saved)).not.toContain("vercel_blob_rw_test");
  });

  it("never returns the Blob token to the client", async () => {
    const body = await (await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")))).json();
    expect(JSON.stringify(body)).not.toContain("vercel_blob_rw_test");
    expect(body).not.toHaveProperty("avatarPath");
  });

  it("removes the previous image after the new one is recorded", async () => {
    state.previousPath = "avatars/user_1/old.png";
    await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(state.del).toEqual(["avatars/user_1/old.png"]);
  });

  it("does not delete an object that is not the caller's", async () => {
    // A row somehow pointing elsewhere must not become a delete primitive.
    state.previousPath = "avatars/user_2/victim.png";
    await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(state.del).toEqual([]);
  });

  it("rejects an unauthenticated upload before touching storage", async () => {
    state.clerkUserId = null;
    const response = await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(response.status).toBe(401);
    expect(state.put).toEqual([]);
  });

  it("rejects a file that is not an image", async () => {
    const html = new TextEncoder().encode("<!doctype html>");
    const response = await avatarRoute.POST(uploadRequest(fileOf(html, "image/png", "x.png")));
    expect(response.status).toBe(400);
    expect(state.put).toEqual([]);
  });

  it("rejects an oversized image with 413", async () => {
    const oversized = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_AVATAR_BYTES + 1);
    const response = await avatarRoute.POST(uploadRequest(fileOf(oversized, "image/png")));
    expect(response.status).toBe(413);
    expect(state.put).toEqual([]);
  });

  it("rejects a request with no file", async () => {
    expect((await avatarRoute.POST(uploadRequest(null))).status).toBe(400);
  });

  it("answers 503 without naming the missing variable when Blob is not configured", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const response = await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(response.status).toBe(503);
    expect((await response.json()).error).not.toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("returns 429 before touching Blob when the account exceeds its upload budget", async () => {
    state.guardFailure = { kind: "rate-limited", retryAfterSeconds: 60 };
    const response = await avatarRoute.POST(uploadRequest(fileOf(PNG(), "image/png")));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(state.put).toEqual([]);
  });
});

describe("DELETE /api/profile/avatar", () => {
  it("clears the columns and removes the stored object", async () => {
    state.previousPath = "avatars/user_1/old.png";
    const response = await avatarRoute.DELETE();
    expect(response.status).toBe(200);
    expect(state.updates[0]).toEqual({ avatarUrl: null, avatarPath: null, avatarUpdatedAt: null });
    expect(state.del).toEqual(["avatars/user_1/old.png"]);
  });

  it("rejects an unauthenticated removal", async () => {
    state.clerkUserId = null;
    expect((await avatarRoute.DELETE()).status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("does not clear the database when Blob credentials are unavailable", async () => {
    state.previousPath = "avatars/user_1/old.png";
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const response = await avatarRoute.DELETE();
    expect(response.status).toBe(503);
    expect(state.updates).toEqual([]);
    expect(state.del).toEqual([]);
  });

  it("does not claim success or clear metadata when Blob deletion fails", async () => {
    state.previousPath = "avatars/user_1/old.png";
    state.deleteFailure = true;
    const response = await avatarRoute.DELETE();
    expect(response.status).toBe(500);
    expect(state.updates).toEqual([]);
  });
});
