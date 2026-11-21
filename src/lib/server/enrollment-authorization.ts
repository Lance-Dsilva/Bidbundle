import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { HoaWorkflowError } from "@/lib/server/hoa";
/** Read the original capped authorization, never manufacture exact-price consent. */
export async function readEnrollmentAuthorization(tx: Prisma.TransactionClient, agreementId: string, payerUserId: string, unitId: string) {
  const authorization = await tx.agreementBillingAuthorization.findUnique({ where: { agreementId_unitId: { agreementId, unitId } } });
  if (!authorization) return null;
  await tx.$queryRaw`SELECT "id" FROM "EnrollmentBillingConsent" WHERE "id"=${authorization.enrollmentConsentId} FOR SHARE`;
  const consent = await tx.enrollmentBillingConsent.findUnique({ where: { id: authorization.enrollmentConsentId }, include: { card: true } });
  const agreement = await tx.serviceAgreement.findUnique({ where: { id: agreementId } });
  if (!consent?.card || consent.revokedAt || consent.termsVersion !== "capped-completed-visit-v1" || authorization.payerUserId !== payerUserId ||
      consent.payerUserId !== payerUserId || consent.unitId !== unitId || consent.providerUserId !== agreement?.providerUserId ||
      consent.requestId !== agreement.requestId || consent.currency !== agreement.currency || authorization.authorizedTotalCents !== agreement.perHomeCents ||
      authorization.authorizedTotalCents > consent.maximumCents) throw new HoaWorkflowError("Enrollment authorization requires billing review.", 409);
  return { id: authorization.id, termsToken: consent.termsToken, acceptedAt: consent.acceptedAt, card: consent.card };
}
