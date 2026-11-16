import "server-only";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_CONNECT !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) {
    throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503);
  }
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}
function returnUrl() {
  const raw = process.env.STRIPE_TEST_APP_URL;
  if (!raw) throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503);
  let url: URL;
  try { url = new URL(raw); } catch { throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503); }
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503);
  }
  return new URL("/app/provider/profile", url.origin).toString();
}
async function profile(userId: string) {
  const row = await db.providerProfile.findUnique({ where: { userId }, select: { stripeTestAccountId: true, accountStatus: true } });
  if (!row || row.accountStatus !== "active") throw new HoaWorkflowError("An active provider profile is required.", 403);
  return row;
}
export async function startStripeTestOnboarding(userId: string) {
  const stripe = stripeClient(); const returnTo = returnUrl();
  let accountId = (await profile(userId)).stripeTestAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({ type: "express", capabilities: { transfers: { requested: true }, card_payments: { requested: true } }, metadata: { bundleenProviderUserId: userId } }, {
      idempotencyKey: `bundleen-test-connect:${createHash("sha256").update(userId).digest("hex")}`,
    });
    await db.providerProfile.updateMany({ where: { userId, accountStatus: "active", stripeTestAccountId: null }, data: { stripeTestAccountId: account.id, stripeTestPayoutStatus: "pending" } });
    accountId = (await profile(userId)).stripeTestAccountId;
  }
  if (!accountId) throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503);
  const link = await stripe.accountLinks.create({ account: accountId, type: "account_onboarding", return_url: returnTo, refresh_url: returnTo });
  // Do not trust a caller-supplied redirect or expose a link after suspension/account replacement.
  if ((await profile(userId)).stripeTestAccountId !== accountId) throw new HoaWorkflowError("Provider account changed. Please retry.", 409);
  const url = new URL(link.url);
  if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com" || url.username || url.password) {
    throw new HoaWorkflowError("Sandbox payout setup is unavailable.", 503);
  }
  return { url: link.url };
}
export function stripeTestPayoutStatus(account: { charges_enabled: boolean; payouts_enabled: boolean; requirements?: Pick<Stripe.Account.Requirements, "disabled_reason" | "past_due"> | null; capabilities?: Pick<Stripe.Account.Capabilities, "transfers"> }) {
  if (account.requirements?.disabled_reason || account.requirements?.past_due?.length) return "restricted";
  return account.charges_enabled && account.payouts_enabled && account.capabilities?.transfers === "active" ? "active" : "pending";
}
export async function refreshStripeTestPayouts(userId: string) {
  const stripe = stripeClient(); const current = await profile(userId);
  if (!current.stripeTestAccountId) return { status: "not_connected" };
  const account = await stripe.accounts.retrieve(current.stripeTestAccountId);
  if (account.id !== current.stripeTestAccountId || account.metadata?.bundleenProviderUserId !== userId) {
    throw new HoaWorkflowError("Sandbox payout account could not be verified.", 409);
  }
  const status = stripeTestPayoutStatus(account);
  const updated = await db.providerProfile.updateMany({ where: { userId, accountStatus: "active", stripeTestAccountId: account.id }, data: { stripeTestPayoutStatus: status } });
  if (updated.count !== 1) throw new HoaWorkflowError("Provider account changed. Please retry.", 409);
  return { status };
}
