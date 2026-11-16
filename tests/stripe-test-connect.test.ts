import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ profile: vi.fn(), update: vi.fn(), create: vi.fn(), retrieve: vi.fn(), link: vi.fn() }));
vi.mock("stripe", () => ({ default: class { accounts = { create: m.create, retrieve: m.retrieve }; accountLinks = { create: m.link }; } }));
vi.mock("@/lib/server/db", () => ({ db: { providerProfile: { findUnique: m.profile, updateMany: m.update } } }));
import { startStripeTestOnboarding, refreshStripeTestPayouts, stripeTestPayoutStatus } from "@/lib/server/stripe-test-connect";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_CONNECT", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture"); vi.stubEnv("STRIPE_TEST_APP_URL", "https://preview.example.invalid");
  m.profile.mockResolvedValue({ accountStatus: "active", stripeTestAccountId: "acct_fixture" });
  m.link.mockResolvedValue({ url: "https://connect.stripe.com/setup/fixture" }); m.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe("sandbox Connect", () => {
  it("uses only configured return URL and the authenticated provider account", async () => {
    expect(await startStripeTestOnboarding("provider")).toEqual({ url: "https://connect.stripe.com/setup/fixture" });
    expect(m.link).toHaveBeenCalledWith({ account: "acct_fixture", type: "account_onboarding", return_url: "https://preview.example.invalid/app/provider/profile", refresh_url: "https://preview.example.invalid/app/provider/profile" });
  });
  it("uses the winning account after concurrent setup", async () => {
    m.profile.mockResolvedValueOnce({ accountStatus: "active", stripeTestAccountId: null }); m.create.mockResolvedValue({ id: "acct_loser" });
    await startStripeTestOnboarding("provider");
    expect(m.link.mock.calls[0][0].account).toBe("acct_fixture");
    expect(m.create.mock.calls[0][0].type).toBe("express");
    expect(m.create.mock.calls[0][1].idempotencyKey).toMatch(/^bundleen-test-connect:/);
  });
  it("rejects live keys before any Stripe operation", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
    await expect(startStripeTestOnboarding("provider")).rejects.toMatchObject({ status: 503 });
    expect(m.create).not.toHaveBeenCalled(); expect(m.link).not.toHaveBeenCalled();
  });
  it("withholds a link after suspension", async () => {
    m.profile.mockResolvedValueOnce({ accountStatus: "active", stripeTestAccountId: "acct_fixture" }).mockResolvedValueOnce({ accountStatus: "suspended", stripeTestAccountId: "acct_fixture" });
    await expect(startStripeTestOnboarding("provider")).rejects.toMatchObject({ status: 403 });
  });
  it("rejects unsafe return or destination URLs", async () => {
    vi.stubEnv("STRIPE_TEST_APP_URL", "http://public.example.invalid");
    await expect(startStripeTestOnboarding("provider")).rejects.toMatchObject({ status: 503 }); expect(m.link).not.toHaveBeenCalled();
    vi.stubEnv("STRIPE_TEST_APP_URL", "https://preview.example.invalid"); m.link.mockResolvedValue({ url: "https://attacker.example.invalid/setup" });
    await expect(startStripeTestOnboarding("provider")).rejects.toMatchObject({ status: 503 });
  });
  it("never treats return from onboarding as payout activation", async () => {
    m.retrieve.mockResolvedValue({ id: "acct_fixture", metadata: { bundleenProviderUserId: "provider" }, charges_enabled: false, payouts_enabled: false, capabilities: {} });
    expect(await refreshStripeTestPayouts("provider")).toEqual({ status: "pending" });
    expect(m.update.mock.calls[0][0].data).toEqual({ stripeTestPayoutStatus: "pending" });
  });
  it("rejects a Stripe account belonging to another provider", async () => {
    m.retrieve.mockResolvedValue({ id: "acct_fixture", metadata: { bundleenProviderUserId: "other" } });
    await expect(refreshStripeTestPayouts("provider")).rejects.toMatchObject({ status: 409 }); expect(m.update).not.toHaveBeenCalled();
  });
  it("marks active only when payouts, charges and transfers are enabled", () => {
    const account = { charges_enabled: true, payouts_enabled: true, capabilities: { transfers: "active" as const }, requirements: { disabled_reason: null, past_due: [] } };
    expect(stripeTestPayoutStatus(account)).toBe("active");
    expect(stripeTestPayoutStatus({ ...account, payouts_enabled: false })).toBe("pending");
    expect(stripeTestPayoutStatus({ ...account, requirements: { disabled_reason: "requirements.past_due", past_due: ["external_account"] } })).toBe("restricted");
  });
});
