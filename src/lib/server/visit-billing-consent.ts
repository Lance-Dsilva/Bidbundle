import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

const TERMS_VERSION = "completed-visit-charge-v1";
const TERMS = "If I add a card for this service, I authorize Bundleen to charge that card the amount shown for each visit after that visit is completed.";

async function readBillingOffer(
  client: Prisma.TransactionClient,
  payerUserId: string,
  agreementId: string,
) {
  const agreement = await client.serviceAgreement.findFirst({
    where: {
      id: agreementId,
      status: "active",
      request: { kind: "optional_group" },
      community: { type: "hoa", status: "active" },
    },
    select: { currency: true, communityId: true },
  });
  if (!agreement) throw new HoaWorkflowError("No billing offer is available.", 404);

  const membership = await client.communityMembership.findFirst({
    where: { userId: payerUserId, communityId: agreement.communityId, status: "active" },
    select: { id: true, unitId: true },
  });
  if (!membership?.unitId) throw new HoaWorkflowError("No billing offer is available.", 404);

  const unitId = membership.unitId;
  const visits = await client.serviceVisit.findMany({
    where: { unitId, occurrence: { agreementId } },
    select: {
      id: true,
      allocatedVisitCents: true,
      billingPayerUserId: true,
      completedAt: true,
      occurrence: { select: { sequence: true } },
    },
    orderBy: { occurrence: { sequence: "asc" } },
  });
  if (visits.length === 0 || visits.some(
    (visit) => visit.allocatedVisitCents === null || visit.billingPayerUserId !== payerUserId,
  )) {
    throw new HoaWorkflowError("No billing offer is available.", 404);
  }

  const prices = visits.map((visit) => ({
    id: visit.id,
    visitNumber: visit.occurrence.sequence,
    amountCents: visit.allocatedVisitCents!,
  }));
  const termsToken = createHash("sha256")
    .update(JSON.stringify([TERMS_VERSION, TERMS, agreementId, payerUserId, unitId, agreement.currency, prices]))
    .digest("hex");
  const consent = await client.visitBillingConsent.findUnique({
    where: { agreementId_payerUserId_unitId: { agreementId, payerUserId, unitId } },
    select: { termsToken: true, termsVersion: true, acceptedAt: true },
  });

  return {
    unitId,
    membershipId: membership.id,
    alreadyCompleted: visits.some((visit) => visit.completedAt !== null),
    consent,
    offer: {
      termsToken,
      currency: agreement.currency,
      totalCents: prices.reduce((sum, visit) => sum + visit.amountCents, 0),
      visits: prices.map(({ visitNumber, amountCents }) => ({ visitNumber, amountCents })),
      terms: TERMS,
      acceptedAt: consent?.termsToken === termsToken && consent.termsVersion === TERMS_VERSION
        ? consent.acceptedAt.toISOString() : null,
    },
  };
}

export async function getVisitBillingOffer(payerUserId: string, agreementId: string) {
  return (await readBillingOffer(db, payerUserId, agreementId)).offer;
}

export async function acceptVisitBillingOffer(
  payerUserId: string,
  agreementId: string,
  termsToken: string,
) {
  return db.$transaction(async (tx) => {
    const prepared = await readBillingOffer(tx, payerUserId, agreementId);
    // Completion also locks the visit before it reads the agreement. Take the
    // same locks first, then re-read the current status and residency.
    await tx.$queryRaw`
      SELECT visit."id" FROM "ServiceVisit" visit
      JOIN "ServiceOccurrence" occurrence ON occurrence."id" = visit."occurrenceId"
      WHERE occurrence."agreementId" = ${agreementId} AND visit."unitId" = ${prepared.unitId}
      ORDER BY visit."id" FOR UPDATE OF visit
    `;
    await tx.$queryRaw`
      SELECT membership."id" FROM "CommunityMembership" membership
      JOIN "Community" community ON community."id" = membership."communityId"
      JOIN "ServiceAgreement" agreement ON agreement."communityId" = community."id"
      WHERE membership."id" = ${prepared.membershipId} AND agreement."id" = ${agreementId}
      FOR SHARE OF agreement, community, membership
    `;
    const snapshot = await readBillingOffer(tx, payerUserId, agreementId);
    if (snapshot.membershipId !== prepared.membershipId || snapshot.unitId !== prepared.unitId ||
        snapshot.offer.termsToken !== termsToken ||
        (snapshot.consent && (snapshot.consent.termsToken !== termsToken ||
          snapshot.consent.termsVersion !== TERMS_VERSION))) {
      throw new HoaWorkflowError("The billing offer has changed. Review the current prices before accepting.", 409);
    }
    if (snapshot.consent) return snapshot.offer;

    if (snapshot.alreadyCompleted) {
      throw new HoaWorkflowError("The service has already started. Contact support before accepting payment terms.", 409);
    }

    const { unitId } = snapshot;
    // CURRENT_TIMESTAMP would report when the transaction began, possibly
    // before the locks were granted. Capture the server's time after the checks.
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await tx.visitBillingConsent.createMany({
      data: { agreementId, payerUserId, unitId, termsToken, termsVersion: TERMS_VERSION, acceptedAt: now },
      skipDuplicates: true,
    });
    const consent = await tx.visitBillingConsent.findUniqueOrThrow({
      where: { agreementId_payerUserId_unitId: { agreementId, payerUserId, unitId } },
      select: { termsToken: true, termsVersion: true, acceptedAt: true },
    });
    if (consent.termsToken !== termsToken || consent.termsVersion !== TERMS_VERSION) {
      throw new HoaWorkflowError("The billing offer has changed. Review the current prices before accepting.", 409);
    }
    return { ...snapshot.offer, acceptedAt: consent.acceptedAt.toISOString() };
  });
}
