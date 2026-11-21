import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), actor: vi.fn(), totals: vi.fn(), charge: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { stripeTestPayment: { findMany: m.list, findFirst: m.find }, user: { findUnique: m.actor }, $queryRaw: m.totals } }));
vi.mock("stripe", () => ({ default: class { charges = { retrieve: m.charge }; } }));
import { getProviderTestPaymentTotals, getResidentTestReceipt, listAdminTestPayments, listProviderTestPayments, listResidentTestPayments } from "@/lib/server/stripe-test-payment-history";
const row = { receiptEmail: "private-receipt@example.invalid", visitId: "visit", requestId: "request", status: "succeeded", amountCents: 1000, amountRefundedCents: 200, providerAmountCents: 900, providerReversedCents: 180, platformFeeCents: 100, currency: "usd", stripeChargeId: "ch_owned", stripeTransferId: "tr_owned", stripePaymentIntentId: "pi_owned", customerId: "cus_owned", paymentMethodId: "pm_private", termsToken: "private-consent", residentUserId: "payer", createdAt: new Date("2026-11-21T00:00:00Z"), visit: { occurrence: { sequence: 1, agreement: { request: { title: "Pool care" }, community: { name: "Synthetic community" } } } } };
const charge = { id: "ch_owned", livemode: false, paid: true, payment_intent: "pi_owned", customer: "cus_owned", amount: 1000, currency: "usd", receipt_url: "https://pay.stripe.com/receipts/payment/fixture" };
const totals = { paymentCount: BigInt(10), chargedCents: BigInt(10000), refundedCents: BigInt(2000), transferredCents: BigInt(9000), reversedCents: BigInt(1800), awaitingTransferCents: BigInt(0), uncollectedCents: BigInt(900), grossFeeCents: BigInt(1000) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  m.list.mockResolvedValue([row]); m.find.mockResolvedValue(row); m.charge.mockResolvedValue(charge); m.totals.mockResolvedValue([totals]);
  m.actor.mockResolvedValue({ role: "admin", isVerified: true, email: "ADMIN@example.invalid", adminAccess: { status: "active", level: "admin", email: "admin@example.invalid" } });
});
afterEach(() => vi.unstubAllEnvs());

it("scopes resident history to the original payer without current unit membership", async () => {
  const history = await listResidentTestPayments("original-payer");
  expect(m.list.mock.calls[0][0].where).toEqual({ residentUserId: "original-payer" });
  expect(history.payments[0]).toMatchObject({ amountCents: 1000, refundedCents: 200, transferredCents: 900, reversedCents: 180, receiptAvailable: true });
  expect(JSON.stringify(history)).not.toMatch(/cus_owned|pm_private|private-consent|private-receipt|pi_owned|ch_owned|tr_owned/);
});
it("scopes provider history to that provider", async () => {
  const history = await listProviderTestPayments("provider-owned");
  expect(JSON.stringify(history)).not.toContain("private-receipt");
  expect(m.list.mock.calls[0][0].where).toEqual({ providerUserId: "provider-owned" });
});
it("uses a bounded page and an owned cursor", async () => {
  m.list.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ ...row, visitId: `visit-${i}` })));
  const result = await listResidentTestPayments("payer", "prior-visit");
  expect(m.find).toHaveBeenCalledWith({ where: { residentUserId: "payer", visitId: "prior-visit" }, select: { visitId: true } });
  expect(m.list.mock.calls[0][0]).toMatchObject({ take: 51, cursor: { visitId: "prior-visit" }, skip: 1 });
  expect(result.payments).toHaveLength(50); expect(result.nextCursor).toBe("visit-49");
});
it("rejects another payer's pagination cursor before querying a page", async () => {
  m.find.mockResolvedValue(null);
  await expect(listResidentTestPayments("payer", "foreign-visit")).rejects.toMatchObject({ status: 404 });
  expect(m.list).not.toHaveBeenCalled();
});
it("admin history applies community and optional request together", async () => {
  await listAdminTestPayments("admin", "community", "request");
  expect(m.list.mock.calls[0][0].where).toEqual({ communityId: "community", requestId: "request" });
});
it.each([
  { role: "admin", isVerified: true, email: "admin@example.invalid", adminAccess: { status: "active", level: "admin", email: "admin@example.invalid", isStaffAccount: true } },
  { role: "admin", isVerified: false, email: "admin@example.invalid", adminAccess: { status: "active", level: "owner", email: "admin@example.invalid" } },
  { role: "homeowner", isVerified: true, email: "admin@example.invalid", adminAccess: { status: "active", level: "admin", email: "admin@example.invalid" } },
  { role: "admin", isVerified: true, email: "admin@example.invalid", adminAccess: null },
  { role: "admin", isVerified: true, email: "admin@example.invalid", adminAccess: { status: "revoked", level: "admin", email: "admin@example.invalid" } },
  { role: "admin", isVerified: true, email: "admin@example.invalid", adminAccess: { status: "active", level: "admin", email: "other@example.invalid" } },
])("denies unauthorized administrator history %j", async actor => {
  m.actor.mockResolvedValue(actor);
  await expect(listAdminTestPayments("actor", "community")).rejects.toMatchObject({ status: 403 });
  expect(m.list).not.toHaveBeenCalled();
});
it("reads totals across all owned payments with a parameterized provider identity", async () => {
  const result = await getProviderTestPaymentTotals("provider-owned");
  expect(m.totals.mock.calls[0].slice(1)).toEqual(["provider-owned"]);
  expect(result).toEqual(Object.fromEntries([...Object.entries(totals).map(([key, value]) => [key, Number(value)]), ["currency", "usd"]]));
});
it("fails closed on unsafe integer totals", async () => {
  m.totals.mockResolvedValue([{ ...totals, chargedCents: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) }]);
  await expect(getProviderTestPaymentTotals("provider")).rejects.toMatchObject({ status: 503 });
});
it("retrieves a receipt only from the exact original payer's charge", async () => {
  await expect(getResidentTestReceipt("payer", "visit")).resolves.toBe(charge.receipt_url);
  expect(m.find).toHaveBeenCalledWith({ where: { visitId: "visit", residentUserId: "payer" } });
  expect(m.charge).toHaveBeenCalledExactlyOnceWith("ch_owned");
});
it("does not call Stripe for a missing or unowned payment", async () => {
  m.find.mockResolvedValue(null);
  await expect(getResidentTestReceipt("other", "visit")).rejects.toMatchObject({ status: 404 });
  expect(m.charge).not.toHaveBeenCalled();
});
it.each([{ livemode: true }, { id: "ch_other" }, { paid: false }, { payment_intent: "pi_other" }, { customer: "cus_other" }, { amount: 999 }, { currency: "eur" }, { receipt_url: null }])("rejects unverified charge receipt %j", async change => {
  m.charge.mockResolvedValue({ ...charge, ...change });
  await expect(getResidentTestReceipt("payer", "visit")).rejects.toMatchObject({ status: 409 });
});
it.each(["javascript:alert(1)", "http://pay.stripe.com/receipts/fixture", "https://pay.stripe.com.evil.invalid/receipts/fixture", "https://user:pass@pay.stripe.com/receipts/fixture", "https://pay.stripe.com:444/receipts/fixture", "https://pay.stripe.com/other", "not a url"])("rejects unsafe hosted receipt URL %s", async receipt_url => {
  m.charge.mockResolvedValue({ ...charge, receipt_url });
  await expect(getResidentTestReceipt("payer", "visit")).rejects.toMatchObject({ status: 409 });
});
it("rejects live credentials before reading Stripe", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
  await expect(getResidentTestReceipt("payer", "visit")).rejects.toMatchObject({ status: 503 });
  expect(m.charge).not.toHaveBeenCalled();
});
it("does no history work when the sandbox feature is disabled", async () => {
  vi.stubEnv("STRIPE_TEST_PAYMENTS", "0");
  await expect(listResidentTestPayments("payer")).rejects.toMatchObject({ status: 404 });
  expect(m.list).not.toHaveBeenCalled();
});
