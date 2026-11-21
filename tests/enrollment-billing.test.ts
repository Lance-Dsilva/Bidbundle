import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ request: vi.fn(), membership: vi.fn(), payer: vi.fn(), readConsent: vi.fn(), requiredConsent: vi.fn(), createConsent: vi.fn(), count: vi.fn(), readParticipation: vi.fn(), createParticipation: vi.fn(), updateParticipation: vi.fn(), createCard: vi.fn(), updateRequest: vi.fn(), raw: vi.fn(), createCustomer: vi.fn(), createSetup: vi.fn(), retrieveSetup: vi.fn(), notify: vi.fn(), cards: vi.fn(), exactCards: vi.fn(), retrieveMethod: vi.fn() }));
vi.mock("stripe", () => ({ default: class {
  customers = { create: m.createCustomer };
  paymentMethods = { retrieve: m.retrieveMethod };
  setupIntents = { create: m.createSetup, retrieve: m.retrieveSetup };
} }));
vi.mock("@/lib/server/price-ladder", () => ({ notifyPriceLadderUnlock: m.notify }));
vi.mock("@/lib/server/db", () => {
  const tx = {
    $queryRaw: m.raw,
    hoaServiceRequest: { findUnique: m.request, update: m.updateRequest },
    communityMembership: { findFirst: m.membership },
    user: { findUnique: m.payer, findUniqueOrThrow: m.payer, updateMany: vi.fn() },
    enrollmentBillingConsent: { findUnique: m.readConsent, findUniqueOrThrow: m.requiredConsent, create: m.createConsent },
    hoaRequestParticipation: { findFirst: m.readParticipation, count: m.count, create: m.createParticipation, update: m.updateParticipation },
    enrollmentBillingCard: { create: m.createCard, findMany: m.cards },
    stripeTestCard: { findMany: m.exactCards },
  };
  return { db: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } };
});
import { getEnrollmentBillingOffer, startEnrollmentBilling, confirmEnrollmentBilling } from "@/lib/server/enrollment-billing";

const commitment = { id: "commitment", providerUserId: "provider", scope: "Two complete visits", acceptedAt: new Date("2026-01-01"), guaranteedPerHomeCents: 12000 };
const request = { id: "request", communityId: "community", community: { type: "hoa", status: "active" }, kind: "optional_group", status: "collecting_interest", poolTemplate: null, participantsLockedAt: null, enrollmentClosesAt: new Date("2099-01-01"), stripeTestEnrollmentRequired: true, category: "cleaning", description: "Two visits", totalOccurrences: 2, recurrenceIntervalDays: null, recurrenceLabel: null, startDate: null, requiresAfterPhoto: true, title: "Service", maxHomes: 5, priceCommitment: commitment };
const membership = { id: "membership", unitId: "unit", userId: "payer", communityId: "community", status: "active" };
const payer = { role: "homeowner", stripeTestCustomerId: "cus_owned" };
const method = { id: "pm_owned", livemode: false, customer: "cus_owned", card: { brand: "visa", last4: "4242" } };
let accepted: { id: string; requestId: string; payerUserId: string; unitId: string; membershipId: string; commitmentId: string; providerUserId: string; maximumCents: number; currency: string; termsToken: string; termsVersion: string; revokedAt: Date | null; acceptedAt: Date; card: null | { setupIntentId: string } };
let setup: { id: string; livemode: boolean; status: string; customer: string; client_secret: string; payment_method: typeof method; metadata: { bundleenEnrollmentConsentId: string; bundleenTermsToken: string } };
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  m.cards.mockResolvedValue([]); m.exactCards.mockResolvedValue([]);
  m.request.mockResolvedValue(request); m.membership.mockResolvedValue(membership); m.payer.mockResolvedValue(payer); m.count.mockResolvedValue(0); m.readParticipation.mockResolvedValue(null);
  const offer = await getEnrollmentBillingOffer("payer", "request");
  accepted = { id: "consent", requestId: "request", payerUserId: "payer", unitId: "unit", membershipId: "membership", commitmentId: "commitment", providerUserId: "provider", maximumCents: 12000, currency: "usd", termsToken: offer.termsToken, termsVersion: "capped-completed-visit-v1", revokedAt: null, acceptedAt: new Date("2026-01-02"), card: null };
  setup = { id: "seti_owned", livemode: false, status: "succeeded", customer: "cus_owned", client_secret: "seti_owned_secret_fixture", payment_method: method, metadata: { bundleenEnrollmentConsentId: "consent", bundleenTermsToken: accepted.termsToken } };
  m.readConsent.mockResolvedValue(accepted); m.requiredConsent.mockResolvedValue(accepted); m.createConsent.mockResolvedValue(accepted);
  m.createSetup.mockResolvedValue(setup); m.retrieveSetup.mockResolvedValue(setup);
});
afterEach(() => vi.unstubAllEnvs());

it("binds setup to the precise accepted capped consent and original customer", async () => {
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken)).resolves.toEqual({ clientSecret: setup.client_secret });
  expect(m.createSetup).toHaveBeenCalledWith({ customer: "cus_owned", usage: "off_session", allowed_payment_method_types: ["card"], metadata: setup.metadata }, { idempotencyKey: "enrollment_setup_consent" });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it("saves new versioned cap consent before any setup and persists request policy", async () => {
  m.readConsent.mockResolvedValueOnce(null); m.request.mockResolvedValue({ ...request, stripeTestEnrollmentRequired: false });
  await startEnrollmentBilling("payer", "request", "consent", accepted.termsToken);
  expect(m.updateRequest).toHaveBeenCalledWith({ where: { id: "request" }, data: { stripeTestEnrollmentRequired: true } });
  expect(m.createConsent.mock.calls[0][0].data).toMatchObject({ maximumCents: 12000, providerUserId: "provider", membershipId: "membership", unitId: "unit", termsVersion: "capped-completed-visit-v1" });
  expect(m.createConsent.mock.invocationCallOrder[0]).toBeLessThan(m.createSetup.mock.invocationCallOrder[0]);
});
it("requires a fresh acceptance when a new consent's displayed price is stale", async () => {
  m.readConsent.mockResolvedValueOnce(null); m.request.mockResolvedValue({ ...request, priceCommitment: { ...commitment, guaranteedPerHomeCents: 10000 } });
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken)).rejects.toMatchObject({ status: 409 });
  expect(m.createSetup).not.toHaveBeenCalled();
});
it("allows a lower reached price under an already accepted cap", async () => {
  m.request.mockResolvedValue({ ...request, priceCommitment: { ...commitment, guaranteedPerHomeCents: 10000 } });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).resolves.toEqual({ joined: true });
  expect(m.createParticipation).toHaveBeenCalledWith({ data: { requestId: "request", unitId: "unit", response: "joined", userId: "payer", enrollmentConsentId: "consent" } });
});
it("rejects a raised price above the accepted cap", async () => {
  m.request.mockResolvedValue({ ...request, priceCommitment: { ...commitment, guaranteedPerHomeCents: 13000 } });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.createParticipation).not.toHaveBeenCalled();
});
it.each([{ payerUserId: "other" }, { requestId: "other" }, { revokedAt: new Date() }])("refuses old or unowned consent before retrieving setup %j", async delta => {
  m.readConsent.mockResolvedValue({ ...accepted, ...delta });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 404 });
  expect(m.retrieveSetup).not.toHaveBeenCalled();
});
it.each([
  { livemode: true }, { status: "requires_action" }, { customer: "cus_other" },
  { metadata: { bundleenEnrollmentConsentId: "old-withdrawn-consent", bundleenTermsToken: "old" } },
  { payment_method: { ...method, livemode: true } }, { payment_method: { ...method, card: null } },
  { payment_method: "pm_unexpanded" },
])("rejects a setup not confirmed for this exact consent/card %j", async delta => {
  m.retrieveSetup.mockResolvedValue({ ...setup, ...delta });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.createParticipation).not.toHaveBeenCalled();
});
it("rejects a matching setup/method owned by another Stripe customer", async () => {
  m.retrieveSetup.mockResolvedValue({ ...setup, customer: "cus_other", payment_method: { ...method, customer: "cus_other" } });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it.each([{ scope: "Changed service" }, { providerUserId: "other-provider" }])("rejects changed provider/service terms after setup %j", async delta => {
  m.request.mockResolvedValue({ ...request, priceCommitment: { ...commitment, ...delta } });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it("rechecks membership after acquiring locks", async () => {
  m.membership.mockResolvedValueOnce(membership).mockResolvedValueOnce({ ...membership, id: "replacement-membership" });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it("rejects consent revoked while setup verification is in flight", async () => {
  m.requiredConsent.mockResolvedValue({ ...accepted, revokedAt: new Date() });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it("does not rewrite card timestamps or notify again on identical joined retry", async () => {
  m.requiredConsent.mockResolvedValue({ ...accepted, card: { setupIntentId: "seti_owned" } });
  m.readParticipation.mockResolvedValue({ response: "joined", userId: "payer", enrollmentConsentId: "consent" });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).resolves.toEqual({ joined: true });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.updateParticipation).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it("returns identical completed enrollment after enrollment closes without new writes", async () => {
  m.request.mockResolvedValue({ ...request, status: "open_for_bids", participantsLockedAt: new Date(), enrollmentClosesAt: new Date("2000-01-01") });
  m.requiredConsent.mockResolvedValue({ ...accepted, card: { setupIntentId: "seti_owned" } });
  m.readParticipation.mockResolvedValue({ response: "joined", userId: "payer", enrollmentConsentId: "consent" });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).resolves.toEqual({ joined: true });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.createParticipation).not.toHaveBeenCalled(); expect(m.updateParticipation).not.toHaveBeenCalled();
});
it("rejects a new enrollment after the deadline even with a previously verified setup", async () => {
  m.request.mockResolvedValue({ ...request, enrollmentClosesAt: new Date("2000-01-01") });
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.createParticipation).not.toHaveBeenCalled();
});
it("does not disclose a setup secret after its current customer changes during Stripe access", async () => {
  m.createSetup.mockImplementationOnce(async () => {
    m.payer.mockResolvedValue({ ...payer, stripeTestCustomerId: "cus_replaced" });
    return setup;
  });
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken)).rejects.toMatchObject({ status: 409 });
});
it("rejects capacity reached before card persistence or enrollment", async () => {
  m.count.mockResolvedValue(5);
  await expect(confirmEnrollmentBilling("payer", "request", "consent", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createCard).not.toHaveBeenCalled(); expect(m.createParticipation).not.toHaveBeenCalled();
});
it.each([{ role: "provider" }, { role: "admin" }])("rejects a nonresident identity %j", async delta => {
  m.payer.mockResolvedValue({ ...payer, ...delta });
  await expect(getEnrollmentBillingOffer("payer", "request")).rejects.toMatchObject({ status: 404 });
});
it("fails closed on live credentials before enrollment mutations", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken)).rejects.toMatchObject({ status: 503 });
  expect(m.createConsent).not.toHaveBeenCalled(); expect(m.createSetup).not.toHaveBeenCalled();
});

const oldCard = { consentId: "old-consent", setupIntentId: "seti_old", customerId: "cus_owned", paymentMethodId: "pm_owned", brand: "visa", last4: "4242" };
async function savedReference() { m.cards.mockResolvedValue([oldCard]); const offer = await getEnrollmentBillingOffer("payer", "request"); return offer.savedCards[0].reference; }
it("offers only opaque descriptions from the current payer customer", async () => {
  const reference = await savedReference();
  expect(reference).toMatch(/^[a-f0-9]{64}$/);
  expect(m.cards).toHaveBeenLastCalledWith(expect.objectContaining({ where: { customerId: "cus_owned", consent: { payerUserId: "payer" } } }));
  expect(m.exactCards).toHaveBeenLastCalledWith(expect.objectContaining({ where: { customerId: "cus_owned", payerUserId: "payer" } }));
  expect(JSON.stringify((await getEnrollmentBillingOffer("payer", "request")).savedCards)).not.toMatch(/pm_owned|seti_old|cus_owned/);
});
it("reuses the owned card through a fresh consent-bound off-session setup without joining or charging", async () => {
  const reference = await savedReference(); m.readConsent.mockResolvedValue(null);
  m.retrieveMethod.mockResolvedValue({ ...method, type: "card" });
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, reference)).resolves.toMatchObject({ usingSavedCard: true });
  expect(m.createConsent).toHaveBeenCalled();
  expect(m.retrieveMethod).toHaveBeenCalledWith("pm_owned");
  expect(m.createSetup).toHaveBeenCalledWith(expect.objectContaining({ payment_method: "pm_owned", usage: "off_session", metadata: setup.metadata }), { idempotencyKey: "enrollment_setup_consent" });
  expect(m.createParticipation).not.toHaveBeenCalled();
});
it("rejects a foreign or stale opaque source before calling Stripe", async () => {
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, "b".repeat(64))).rejects.toMatchObject({ status: 409 });
  expect(m.retrieveMethod).not.toHaveBeenCalled(); expect(m.createSetup).not.toHaveBeenCalled();
});
it.each([{ customer: null }, { customer: "cus_foreign" }, { livemode: true }, { type: "us_bank_account" }, { id: "pm_other" }, { card: null }])("rejects changed processor saved-card identity %j", async change => {
  const reference = await savedReference(); m.retrieveMethod.mockResolvedValue({ ...method, type: "card", ...change });
  await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, reference)).rejects.toMatchObject({ status: 409 });
  expect(m.createSetup).not.toHaveBeenCalled();
});

it("rejects unexpected setup selection rather than verifying another card", async () => {
 const reference = await savedReference(); m.retrieveMethod.mockResolvedValue({ ...method, type: "card" });
 m.createSetup.mockResolvedValue({ ...setup, payment_method: "pm_other" });
 await expect(startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, reference)).rejects.toMatchObject({ status: 503 });
 expect(m.createParticipation).not.toHaveBeenCalled();
});
it("saved-card setup retry retains exact consent and Stripe idempotency identity", async () => {
 const reference = await savedReference(); m.retrieveMethod.mockResolvedValue({ ...method, type: "card" });
 await startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, reference);
 await startEnrollmentBilling("payer", "request", "consent", accepted.termsToken, reference);
 expect(m.createSetup.mock.calls[0]).toEqual(m.createSetup.mock.calls[1]);
 expect(m.createParticipation).not.toHaveBeenCalled();
});
