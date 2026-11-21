import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db;
import { getProviderTestPaymentTotals, listProviderTestPayments, listResidentTestPayments } from "@/lib/server/stripe-test-payment-history";
const tag = randomUUID();
const providerId = `history-provider-${tag}`, payerId = `history-payer-${tag}`;
let ownVisit = "", foreignVisit = "";
beforeAll(async () => {
  // Read-model fixtures only: use unused synthetic legacy visit references.
  // This does not exercise or claim successful charge/transfer execution.
  const visits = await db.serviceVisit.findMany({ where: { testPayment: null, occurrence: { agreement: { request: { stripeTestEnrollmentRequired: false } } } }, take: 9, include: { occurrence: { include: { agreement: true } } } });
  if (visits.length !== 9) throw new Error("Run owned billing fixtures first; nine unused synthetic legacy visits required.");
  const states = ["succeeded", "partially_refunded", "refunded", "partially_refunded", "failed", "requires_action", "pending", "disputed", "succeeded"];
  for (const [index, visit] of visits.entries()) {
    const agreement = visit.occurrence.agreement;
    await db.stripeTestPayment.create({ data: {
      visitId: visit.id, requestId: agreement.requestId, agreementId: agreement.id, communityId: agreement.communityId,
      residentUserId: index === 8 ? `other-${payerId}` : payerId, providerUserId: index === 8 ? `other-${providerId}` : providerId,
      unitId: visit.unitId!, customerId: `cus_${tag}`, paymentMethodId: `pm_${tag}`, providerAccountId: `acct_${tag}`, termsToken: `history-fixture-${tag}`,
      amountCents: 1000, platformFeeCents: 100, providerAmountCents: 900, currency: "usd", status: states[index],
      amountRefundedCents: index === 1 ? 200 : index === 2 ? 1000 : 0,
      observedChargeRefundedCents: index === 3 ? 100 : 0,
      observedProviderReversedCents: index === 7 ? 200 : 0,
      reconciliationHoldReason: index === 3 ? "external_refund" : index === 7 ? "processor_dispute" : null,
      providerReversedCents: index === 1 ? 180 : index === 2 ? 900 : 0,
      stripeChargeId: [0, 1, 2, 3, 7, 8].includes(index) ? `ch_${tag}_${index}` : null,
      stripeTransferId: [0, 1, 2, 7, 8].includes(index) ? `tr_${tag}_${index}` : null,
    } });
  }
  ownVisit = visits[0].id; foreignVisit = visits[8].id;
});
afterAll(() => db.$disconnect());
it("aggregates settled, refunded, transferred, reversed and uncollected amounts without counting another provider", async () => {
  expect(await getProviderTestPaymentTotals(providerId)).toEqual({ paymentCount: 8, reviewPaymentCount: 2, chargedCents: 5000, refundedCents: 1300, transferredCents: 3600, reversedCents: 1280, awaitingTransferCents: 0, uncollectedCents: 2700, grossFeeCents: 500, currency: "usd" });
});
it("restricts persisted histories to each original payer and provider", async () => {
  const resident = await listResidentTestPayments(payerId), provider = await listProviderTestPayments(providerId);
  expect(resident.payments).toHaveLength(8); expect(resident.payments.filter(row => row.requiresReview)).toHaveLength(2); expect(provider.payments).toHaveLength(8);
  expect(resident.payments.some(row => row.visitId === ownVisit)).toBe(true);
  expect(resident.payments.some(row => row.visitId === foreignVisit)).toBe(false);
  expect(provider.payments.some(row => row.visitId === foreignVisit)).toBe(false);
  await expect(listResidentTestPayments(payerId, foreignVisit)).rejects.toMatchObject({ status: 404 });
});
it("returns zero totals for an unrelated provider", async () => {
  const totals = await getProviderTestPaymentTotals(`absent-${tag}`);
  expect(totals.paymentCount).toBe(0); expect(totals.chargedCents).toBe(0); expect(totals.transferredCents).toBe(0);
});
