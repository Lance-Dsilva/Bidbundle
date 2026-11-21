import "server-only";
import { db } from "@/lib/server/db";
import { enqueueNotifications } from "@/lib/server/notifications";

/** Never include a client secret or processor error in messages. */
export async function notifyStripeTestPaymentProblem(visitId: string) {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") return;
  const payment = await db.stripeTestPayment.findUnique({ where: { visitId } });
  if (!payment || !["failed", "requires_action"].includes(payment.status)) return;
  const [payer, admins] = await Promise.all([
    db.user.findUnique({ where: { id: payment.residentUserId }, select: { id: true, email: true } }),
    db.user.findMany({ where: { role: "admin", adminAccess: { status: "active" } }, select: { id: true, email: true } }),
  ]);
  const linkPath = `/app/homeowner/billing/payments/${encodeURIComponent(visitId)}`;
  const version = payment.lastRecoveryAttemptId ?? "initial";
  await enqueueNotifications([
    ...(payer ? [{ userId: payer.id, email: payer.email, kind: "account" as const, emailLinkOrigin: "stripe_test" as const, emailPolicy: "required" as const,
      title: "Your sandbox payment needs attention",
      body: payment.status === "requires_action" ? "Your bank needs you to verify this test payment. Sign in to continue." : "Your test payment did not complete. Sign in to review it and try another test card.",
      linkPath, dedupeKey: `stripe-test-problem:${visitId}:${version}:${payment.status}:${payer.id}` }] : []),
    ...admins.map(admin => ({ userId: admin.id, email: admin.email, kind: "account" as const, emailLinkOrigin: "stripe_test" as const, emailPolicy: "required" as const,
      title: "Sandbox payment needs attention", body: "A resident test payment requires follow-up. No provider transfer is authorized by this notification.",
      linkPath: "/app/admin", dedupeKey: `stripe-test-problem:${visitId}:${version}:${payment.status}:${admin.id}` })),
  ]);
}
