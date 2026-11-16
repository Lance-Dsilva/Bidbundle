import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  stripeTestCard: { upsert: vi.fn(), findUnique: vi.fn() },
  serviceAgreement: { findFirst: vi.fn() },
  communityMembership: { findFirst: vi.fn() },
  serviceVisit: { findMany: vi.fn() },
  visitBillingConsent: {
    findUnique: vi.fn(),
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
}));

vi.mock("@/lib/server/db", () => ({
  db: { ...store, $transaction: (fn: (tx: typeof store) => unknown) => fn(store) },
}));

import { acceptVisitBillingOffer, getVisitBillingOffer, saveVerifiedStripeTestCard } from "@/lib/server/visit-billing-consent";

const payer = "original-resident";
const agreement = "agreement";
const acceptedAt = new Date("2026-11-16T15:00:00Z");

const visits = [
  { id: "visit-1", billingPayerUserId: payer, allocatedVisitCents: 1501, completedAt: null, occurrence: { sequence: 1 } },
  { id: "visit-2", billingPayerUserId: payer, allocatedVisitCents: 1500, completedAt: null, occurrence: { sequence: 2 } },
];

beforeEach(() => {
  vi.resetAllMocks();
  store.serviceAgreement.findFirst.mockResolvedValue({ currency: "usd", communityId: "hoa" });
  store.communityMembership.findFirst.mockResolvedValue({ id: "membership", unitId: "unit" });
  store.$queryRaw.mockResolvedValue([{ now: acceptedAt }]);
  store.serviceVisit.findMany.mockResolvedValue(visits);
  store.visitBillingConsent.findUnique.mockResolvedValue(null);
});

describe("final-price consent", () => {
  it("binds explicit acceptance to the quoted visits and original payer", async () => {
    const offer = await getVisitBillingOffer(payer, agreement);
    expect(offer).toMatchObject({
      totalCents: 3001,
      currency: "usd",
      visits: [{ visitNumber: 1, amountCents: 1501 }, { visitNumber: 2, amountCents: 1500 }],
      acceptedAt: null,
    });
    store.visitBillingConsent.findUniqueOrThrow.mockResolvedValue({ termsToken: offer.termsToken, termsVersion: "completed-visit-charge-v1", acceptedAt });

    const result = await acceptVisitBillingOffer(payer, agreement, offer.termsToken);
    expect(store.visitBillingConsent.createMany).toHaveBeenCalledWith({
      data: {
        agreementId: agreement,
        payerUserId: payer,
        unitId: "unit",
        termsToken: offer.termsToken,
        termsVersion: "completed-visit-charge-v1",
        acceptedAt,
      },
      skipDuplicates: true,
    });
    expect(result.acceptedAt).toBe(acceptedAt.toISOString());
  });

  it("rejects a replacement occupant even if assigned to the same unit", async () => {
    const offer = await getVisitBillingOffer(payer, agreement);
    await expect(acceptVisitBillingOffer("replacement-resident", agreement, offer.termsToken))
      .rejects.toMatchObject({ status: 404 });
    expect(store.visitBillingConsent.createMany).not.toHaveBeenCalled();
  });

  it("rejects stale terms even if the new amount has the same total", async () => {
    const original = await getVisitBillingOffer(payer, agreement);
    store.serviceVisit.findMany.mockResolvedValue([
      { ...visits[0], allocatedVisitCents: 1500 },
      { ...visits[1], allocatedVisitCents: 1501 },
    ]);
    await expect(acceptVisitBillingOffer(payer, agreement, original.termsToken))
      .rejects.toMatchObject({ status: 409 });
    expect(store.visitBillingConsent.createMany).not.toHaveBeenCalled();
  });

  it("rechecks residency and visit completion after acquiring the locks", async () => {
    const offer = await getVisitBillingOffer(payer, agreement);
    store.communityMembership.findFirst
      .mockResolvedValueOnce({ id: "membership", unitId: "unit" }).mockResolvedValueOnce(null);
    await expect(acceptVisitBillingOffer(payer, agreement, offer.termsToken))
      .rejects.toMatchObject({ status: 404 });
    expect(store.$queryRaw).toHaveBeenCalledTimes(2);

    store.serviceVisit.findMany
      .mockResolvedValueOnce(visits)
      .mockResolvedValueOnce([{ ...visits[0], completedAt: acceptedAt }, visits[1]]);
    await expect(acceptVisitBillingOffer(payer, agreement, offer.termsToken))
      .rejects.toMatchObject({ status: 409 });
    expect(store.visitBillingConsent.createMany).not.toHaveBeenCalled();
  });

  it("rejects new acceptance after a visit completes but preserves an existing acceptance on retry", async () => {
    const offer = await getVisitBillingOffer(payer, agreement);
    store.serviceVisit.findMany.mockResolvedValue([{ ...visits[0], completedAt: acceptedAt }, visits[1]]);
    await expect(acceptVisitBillingOffer(payer, agreement, offer.termsToken))
      .rejects.toMatchObject({ status: 409 });
    store.visitBillingConsent.findUnique.mockResolvedValue({ termsToken: offer.termsToken, termsVersion: "completed-visit-charge-v1", acceptedAt });
    await expect(acceptVisitBillingOffer(payer, agreement, offer.termsToken))
      .resolves.toMatchObject({ acceptedAt: acceptedAt.toISOString() });
    expect(store.visitBillingConsent.createMany).not.toHaveBeenCalled();
  });
});


describe("verified sandbox card binding", () => {
  const card = { customerId: "cus_fixture", paymentMethodId: "pm_fixture", setupIntentId: "seti_fixture", brand: "visa", last4: "4242" };
  async function acceptedOffer() {
    const offer = await getVisitBillingOffer(payer, agreement);
    store.visitBillingConsent.findUnique.mockResolvedValue({ termsToken: offer.termsToken, termsVersion: "completed-visit-charge-v1", acceptedAt });
    store.user.findUnique.mockResolvedValue({ stripeTestCustomerId: card.customerId });
    return { termsToken: offer.termsToken, acceptedAt: acceptedAt.toISOString() };
  }
  it("persists only the verified reference against the locked exact consent", async () => {
    const expected = await acceptedOffer();
    await saveVerifiedStripeTestCard(payer, agreement, expected, card);
    expect(store.$queryRaw).toHaveBeenCalledTimes(3);
    expect(store.stripeTestCard.upsert).toHaveBeenCalledWith({
      where: { agreementId_payerUserId_unitId: { agreementId: agreement, payerUserId: payer, unitId: "unit" } },
      create: { agreementId: agreement, payerUserId: payer, unitId: "unit", ...card },
      update: { ...card, verifiedAt: expect.any(Date) },
    });
  });
  it("preserves original verification time on identical setup retries", async () => {
    const expected = await acceptedOffer();
    store.stripeTestCard.findUnique.mockResolvedValue({ ...card, verifiedAt: acceptedAt });
    await saveVerifiedStripeTestCard(payer, agreement, expected, card);
    expect(store.stripeTestCard.upsert).not.toHaveBeenCalled();
  });
  it("rejects revoked consent after lock acquisition", async () => {
    const expected = await acceptedOffer();
    store.visitBillingConsent.findUnique.mockResolvedValueOnce({ termsToken: expected.termsToken, termsVersion: "completed-visit-charge-v1", acceptedAt }).mockResolvedValueOnce(null);
    await expect(saveVerifiedStripeTestCard(payer, agreement, expected, card)).rejects.toMatchObject({ status: 409 });
    expect(store.stripeTestCard.upsert).not.toHaveBeenCalled();
  });
  it("rejects a changed Stripe customer or replaced membership", async () => {
    const expected = await acceptedOffer();
    store.user.findUnique.mockResolvedValue({ stripeTestCustomerId: "cus_other" });
    await expect(saveVerifiedStripeTestCard(payer, agreement, expected, card)).rejects.toMatchObject({ status: 409 });
    store.user.findUnique.mockResolvedValue({ stripeTestCustomerId: card.customerId });
    store.communityMembership.findFirst.mockResolvedValueOnce({ id: "membership", unitId: "unit" }).mockResolvedValueOnce({ id: "replacement-membership", unitId: "unit" });
    await expect(saveVerifiedStripeTestCard(payer, agreement, expected, card)).rejects.toMatchObject({ status: 409 });
    expect(store.stripeTestCard.upsert).not.toHaveBeenCalled();
  });
});
