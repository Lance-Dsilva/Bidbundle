import "server-only";
import { Webhook } from "svix";
import { db } from "@/lib/server/db";
import { lockVendorEmail } from "@/lib/server/vendor-core";
import { vendorEmailDigest } from "@/lib/server/vendor-invitation-tokens";
import { VendorSourcingError } from "@/lib/server/vendor-errors";

const supported = new Set(["email.sent", "email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained"]);
/** Signature verification uses the original bytes; persist the Svix ID before
 * side effects so delivery retries are harmless, including events arriving
 * before the send response saved the provider's message ID. */
export async function ingestResendWebhook(rawBody: string, headers: Headers | Record<string, string>) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new VendorSourcingError("Vendor webhook is not configured.", 503);
  if (Buffer.byteLength(rawBody) > 64 * 1024) throw new VendorSourcingError("Webhook is too large.", 413);
  const h = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
  let event: unknown;
  try { new Webhook(secret).verify(rawBody, h); event = JSON.parse(rawBody); }
  catch { throw new VendorSourcingError("Invalid webhook signature.", 400); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new VendorSourcingError("Invalid webhook event.", 400);
  const value = event as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  const id = h["svix-id"];
  if (!id || id.length > 200 || typeof value.type !== "string") throw new VendorSourcingError("Invalid webhook event.", 400);
  if (!supported.has(value.type)) return { received: true as const };
  const occurredAt = typeof value.created_at === "string" ? new Date(value.created_at) : null;
  if (typeof value.data?.email_id !== "string" || !value.data.email_id || value.data.email_id.length > 200 || !occurredAt || !Number.isFinite(+occurredAt)) throw new VendorSourcingError("Invalid webhook event.", 400);
  const providerMessageId = value.data.email_id;
  await db.vendorWebhookEvent.createMany({ data: [{ id, providerMessageId, eventType: value.type, occurredAt }], skipDuplicates: true });
  const persisted = await db.vendorWebhookEvent.findUniqueOrThrow({ where: { id } });
  if (persisted.providerMessageId !== providerMessageId || persisted.eventType !== value.type || +persisted.occurredAt !== +occurredAt) throw new VendorSourcingError("Webhook identity conflicts with a prior event.", 409);
  await reconcileVendorWebhookEvents(providerMessageId);
  return { received: true as const };
}

export async function reconcileVendorWebhookEvents(providerMessageId: string) {
  const initial = await db.vendorOutreachMessage.findUnique({ where: { providerMessageId }, include: { invitation: { select: { emailDigest: true } } } });
  const registered = initial ? null : await db.outboxEvent.findFirst({ where: { providerMessageId, kind: "notification_email" } });
  const payload = registered?.payload as { to?: unknown; vendorOutreach?: unknown } | undefined;
  const registeredInvite = registered && (payload?.vendorOutreach === true || /^email:provider-(bid-invite|request-open):/.test(registered.dedupeKey));
  const emailDigest = initial?.invitation.emailDigest ?? (registeredInvite && typeof payload?.to === "string" ? vendorEmailDigest(payload.to) : null);
  if (!emailDigest) return; // Send/outbox acknowledgement retries reconciliation.
  await db.$transaction(async tx => {
    await lockVendorEmail(tx, emailDigest);
    const message = initial ? await tx.vendorOutreachMessage.findUniqueOrThrow({ where: { id: initial.id } }) : null;
    const events = await tx.vendorWebhookEvent.findMany({ where: { providerMessageId, processedAt: null }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    for (const event of events) {
      if (event.eventType === "email.bounced" || event.eventType === "email.complained") {
        await tx.vendorEmailSuppression.upsert({ where: { emailDigest }, create: { emailDigest, reason: "bounced" }, update: {} });
        await tx.vendorLead.updateMany({ where: { emailDigest, status: { not: "unsubscribed" } }, data: { status: "bounced" } });
        await tx.vendorRequestInvitation.updateMany({ where: { emailDigest, claimedProviderUserId: null, revokedAt: null }, data: { revokedAt: new Date() } });
      } else if (event.eventType === "email.delivered" && message) {
        await tx.vendorOutreachMessage.updateMany({ where: { id: message.id, deliveredAt: null }, data: { deliveredAt: event.occurredAt } });
      } else if ((event.eventType === "email.opened" || event.eventType === "email.clicked") && message) {
        const field = event.eventType === "email.opened" ? "openedAt" : "clickedAt";
        await tx.vendorRequestInvitation.updateMany({ where: { id: message.invitationId, [field]: null }, data: { [field]: event.occurredAt } });
        const invitation = await tx.vendorRequestInvitation.findUniqueOrThrow({ where: { id: message.invitationId } });
        await tx.vendorLead.updateMany({ where: { id: invitation.leadId, status: { in: ["new", "invited"] } }, data: { status: "engaged" } });
      }
      await tx.vendorWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    }
  });
}
