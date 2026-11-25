import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVendorBidToken, createVendorInvitationNonce, createVendorUnsubscribeToken,
  parseVendorBidToken, parseVendorUnsubscribeToken, vendorEmailDigest, vendorOutreachConfiguration,
} from "@/lib/server/vendor-invitation-tokens";

const syntheticSecret = "issue59-synthetic-signing-key-at-least-32-bytes";
const config = {
  RESEND_API_KEY: "synthetic-no-delivery", VENDOR_OUTREACH_FROM_ADDRESS: "Bundleen <invites@invites.bundleen.example>",
  VENDOR_OUTREACH_POSTAL_ADDRESS: "1 Synthetic Office, Test City, CA 90001", RESEND_WEBHOOK_SECRET: "synthetic-webhook-only",
  VENDOR_INVITE_TOKEN_SECRET: syntheticSecret, APP_URL: "https://bundleen.example",
  VENDOR_OUTREACH_ENABLED: "true", VENDOR_OUTREACH_DOMAIN_READY: "true",
};
beforeEach(() => { for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value); vi.stubEnv("VENDOR_OUTREACH_SENDING_DOMAIN", "invites.bundleen.example"); });
afterEach(() => vi.unstubAllEnvs());

describe("purpose-separated opaque vendor invitation links", () => {
  it("round-trips one opaque invitation without embedding email or commercial details", () => {
    const nonce = createVendorInvitationNonce();
    const token = createVendorBidToken("invitation-1", nonce);
    expect(parseVendorBidToken(token)).toEqual({ id: "invitation-1", nonce });
    expect(token.length).toBeLessThanOrEqual(173);
    expect(token).not.toMatch(/@|resident|address|scope|price|license/i);
    expect(createVendorInvitationNonce()).not.toBe(nonce);
  });
  it("binds both identity and nonce to the signed invitation", () => {
    const nonce = createVendorInvitationNonce();
    const token = createVendorBidToken("invitation-1", nonce);
    for (const changed of [token.replace("invitation-1", "invitation-2"), token.replace(nonce, createVendorInvitationNonce()), token.slice(0, -1), token + "x"]) {
      expect(() => parseVendorBidToken(changed)).toThrow();
    }
  });
  it.each(["", "../../etc/passwd", "a.b.c", "a".repeat(10000), "<script>", "a/b.c.d"])("refuses malformed public token %s", (token) => {
    expect(() => parseVendorBidToken(token)).toThrow();
  });
  it("keeps unsubscribe purpose separate and normalizes address identity", () => {
    const digest = vendorEmailDigest("  OWNER@EXAMPLE.INVALID ");
    expect(digest).toBe(vendorEmailDigest("owner@example.invalid"));
    const unsubscribe = createVendorUnsubscribeToken(digest);
    expect(parseVendorUnsubscribeToken(unsubscribe)).toBe(digest);
    expect(unsubscribe).not.toContain("owner"); expect(unsubscribe).not.toContain("@");
    expect(() => parseVendorBidToken(unsubscribe)).toThrow();
    expect(() => parseVendorUnsubscribeToken(createVendorBidToken("invitation-1", createVendorInvitationNonce()))).toThrow();
    expect(() => parseVendorUnsubscribeToken(unsubscribe.replace(digest, "0".repeat(64)))).toThrow();
  });
  it("fails closed without the dedicated signing key even if unrelated secrets exist", () => {
    vi.stubEnv("VENDOR_INVITE_TOKEN_SECRET", ""); vi.stubEnv("CLERK_SECRET_KEY", "unrelated-clerk-secret"); vi.stubEnv("RESEND_API_KEY", "unrelated-resend-secret");
    expect(() => createVendorBidToken("invitation-1", createVendorInvitationNonce())).toThrow();
    expect(() => createVendorUnsubscribeToken(vendorEmailDigest("owner@example.invalid"))).toThrow();
  });
  it("refuses weak secrets and invalidates old links after deliberate key rotation", () => {
    const token = createVendorBidToken("invitation-1", createVendorInvitationNonce());
    vi.stubEnv("VENDOR_INVITE_TOKEN_SECRET", "x".repeat(31)); expect(() => parseVendorBidToken(token)).toThrow();
    vi.stubEnv("VENDOR_INVITE_TOKEN_SECRET", "different-synthetic-signing-key-at-least-32-bytes"); expect(() => parseVendorBidToken(token)).toThrow();
  });
});

describe("outreach cannot borrow normal application email configuration", () => {
  it("supports a preview application origin independent from the approved sending domain", () => {
    vi.stubEnv("APP_URL", "https://preview-project.vercel.app");
    expect(vendorOutreachConfiguration().ready).toBe(true);
  });
  it("checks the dedicated subdomain shape when no explicit sender domain pin is configured", () => {
    vi.stubEnv("VENDOR_OUTREACH_SENDING_DOMAIN", "");
    expect(vendorOutreachConfiguration().ready).toBe(true);
    vi.stubEnv("VENDOR_OUTREACH_FROM_ADDRESS", "invites@example.com");
    expect(vendorOutreachConfiguration().ready).toBe(false);
  });
  it("requires an explicitly enabled dedicated sending subdomain and verified prerequisites", () => {
    expect(vendorOutreachConfiguration()).toMatchObject({ ready: true, missing: [], dailyLimit: 25, requestLimit: 25 });
  });
  it.each(Object.keys(config))("fails closed when %s is missing", (key) => {
    vi.stubEnv(key, ""); vi.stubEnv("EMAIL_FROM_ADDRESS", "notifications@bundleen.example");
    expect(vendorOutreachConfiguration().ready).toBe(false);
  });
  it.each(["false", "1", "TRUE", "yes"])("does not interpret the enable flag %s as approval", (value) => {
    vi.stubEnv("VENDOR_OUTREACH_ENABLED", value); expect(vendorOutreachConfiguration().ready).toBe(false);
  });
  it.each(["invites@bundleen.example", "invites@bundleen.example.attacker.invalid", "invalid-address", "Bundleen\r\nBcc: attacker@example.invalid <invites@invites.bundleen.example>"])("refuses unsafe or non-dedicated sender %s", (from) => {
    vi.stubEnv("VENDOR_OUTREACH_FROM_ADDRESS", from); expect(vendorOutreachConfiguration().ready).toBe(false);
  });
  it.each(["http://bundleen.example", "https://user:password@bundleen.example", "https://bundleen.example?token=secret", "https://bundleen.example#fragment", "https://bundleen.example/path"])("refuses an unsafe public origin %s", (origin) => {
    vi.stubEnv("APP_URL", origin); expect(vendorOutreachConfiguration().ready).toBe(false);
  });
  it("caps configured rate limits rather than accepting arbitrary caller-scale sends", () => {
    vi.stubEnv("VENDOR_OUTREACH_DAILY_LIMIT", "1000000"); vi.stubEnv("VENDOR_OUTREACH_REQUEST_LIMIT", "1000000");
    expect(vendorOutreachConfiguration()).toMatchObject({ dailyLimit: 200, requestLimit: 100 });
    vi.stubEnv("VENDOR_OUTREACH_DAILY_LIMIT", "-1"); vi.stubEnv("VENDOR_OUTREACH_REQUEST_LIMIT", "1.5");
    expect(vendorOutreachConfiguration()).toMatchObject({ dailyLimit: 25, requestLimit: 25 });
  });
});
