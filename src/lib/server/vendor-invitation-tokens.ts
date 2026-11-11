import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { VendorSourcingError } from "@/lib/server/vendor-errors";

function secret(): string {
  const value = process.env.VENDOR_INVITE_TOKEN_SECRET ?? "";
  if (value.length < 32) throw new VendorSourcingError("Vendor invitation signing is not configured.", 503);
  return value;
}
function mac(purpose: string, value: string): string { return createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("base64url"); }
function matches(a: string, b: string): boolean { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
export function vendorEmailDigest(email: string): string { return createHash("sha256").update(email.trim().toLowerCase()).digest("hex"); }
export function createVendorInvitationNonce(): string { return randomBytes(24).toString("base64url"); }
export function createVendorBidToken(id: string, nonce: string): string { return `${id}.${nonce}.${mac("bid", `${id}.${nonce}`)}`; }
export function parseVendorBidToken(token: string): { id: string; nonce: string } {
  const match = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{24,64})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || !matches(match[3], mac("bid", `${match[1]}.${match[2]}`))) throw new VendorSourcingError("This invitation is unavailable.", 404);
  return { id: match[1], nonce: match[2] };
}
export function createVendorUnsubscribeToken(emailDigest: string): string { return `u.${emailDigest}.${mac("unsubscribe", emailDigest)}`; }
export function parseVendorUnsubscribeToken(token: string): string {
  const match = /^u\.([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || !matches(match[2], mac("unsubscribe", match[1]))) throw new VendorSourcingError("This unsubscribe link is unavailable.", 404);
  return match[1];
}
export function vendorOutreachConfiguration() {
  const missing: string[] = [];
  const required = ["RESEND_API_KEY", "VENDOR_OUTREACH_FROM_ADDRESS", "VENDOR_OUTREACH_POSTAL_ADDRESS", "RESEND_WEBHOOK_SECRET", "VENDOR_INVITE_TOKEN_SECRET", "APP_URL"];
  for (const key of required) if (!process.env[key]?.trim()) missing.push(key);
  if (process.env.VENDOR_OUTREACH_ENABLED !== "true") missing.push("VENDOR_OUTREACH_ENABLED");
  if (process.env.VENDOR_OUTREACH_DOMAIN_READY !== "true") missing.push("VENDOR_OUTREACH_DOMAIN_READY");
  if ((process.env.VENDOR_INVITE_TOKEN_SECRET?.length ?? 0) < 32 && !missing.includes("VENDOR_INVITE_TOKEN_SECRET")) missing.push("VENDOR_INVITE_TOKEN_SECRET");
  const from = process.env.VENDOR_OUTREACH_FROM_ADDRESS?.trim() ?? "";
  const postalAddress = process.env.VENDOR_OUTREACH_POSTAL_ADDRESS?.trim() ?? "";
  const appUrl = process.env.APP_URL?.trim() ?? "";
  try {
    const origin = new URL(appUrl);
    const address = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
    const domain = address.split("@")[1]?.toLowerCase();
    const senderDomain = process.env.VENDOR_OUTREACH_SENDING_DOMAIN?.trim().toLowerCase();
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || /[\r\n\0]/.test(appUrl)) missing.push("APP_URL_HTTPS");
    if (/[\r\n\0]/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !domain || (senderDomain ? domain !== senderDomain : domain.split(".").length < 3)) missing.push("DEDICATED_SENDING_SUBDOMAIN");
  } catch { missing.push("APP_URL_HTTPS"); }
  if (postalAddress.length < 8 || postalAddress.length > 500) missing.push("POSTAL_ADDRESS");
  const limit = (name: string, fallback: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
  };
  return { ready: missing.length === 0, missing: [...new Set(missing)], from, postalAddress, appUrl,
    dailyLimit: limit("VENDOR_OUTREACH_DAILY_LIMIT", 25, 200), requestLimit: limit("VENDOR_OUTREACH_REQUEST_LIMIT", 25, 100) };
}
