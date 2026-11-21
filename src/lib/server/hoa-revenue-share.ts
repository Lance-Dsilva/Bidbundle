import "server-only";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { Prisma, HoaShareStatement, HoaSharePayout } from "@/generated/prisma/client";
import type { HoaShareDashboard, HoaShareStatementExport, HoaShareStatementView } from "@/lib/hoa-revenue-share-types";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { requireStripeRefundOwner } from "@/lib/server/stripe-test-refunds";
type Tx = Prisma.TransactionClient;
const WINDOW = 23 * 60 * 60 * 1000;
function enabled() { if (process.env.HOA_REVENUE_SHARE !== "1") throw new HoaWorkflowError("HOA revenue sharing is unavailable.", 503); }
function stripeClient() {
  enabled(); const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_PAYMENTS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox HOA payouts are unavailable.", 503);
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}
async function access(tx: Tx, actor: string, communityId: string, owner = false) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor } });
  if (owner || user?.role === "admin") await requireStripeRefundOwner(tx, actor);
  else {
    await tx.$queryRaw`SELECT "id" FROM "CommunityStaffAssignment" WHERE "communityId"=${communityId} AND "userId"=${actor} FOR SHARE`;
    if (!user?.isVerified || !await tx.communityStaffAssignment.findFirst({ where: { communityId, userId: actor, role: "hoa_manager", status: "active" } })) throw new HoaWorkflowError("Community manager access is required.", 403);
  }
  await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${communityId} FOR UPDATE`;
  const community = await tx.community.findUnique({ where: { id: communityId } });
  if (!community || community.type !== "hoa" || community.status !== "active") throw new HoaWorkflowError("Active HOA not found.", 404);
  return community;
}
async function audit(tx: Tx, actor: string, communityId: string, operation: string, metadata: Record<string, string | number>) {
  await tx.adminAuditLog.create({ data: { actorUserId: actor, action: "marketplace_recovery_action", targetType: "community", targetId: communityId, communityId, metadata: { operation, ...metadata } } });
}
async function totals(tx: Tx, communityId: string, excludePayout?: string) {
  const earned = await tx.hoaShareEntry.aggregate({ where: { communityId }, _sum: { amountCents: true, savingsCents: true } });
  const paid = await tx.hoaSharePayout.aggregate({ where: { communityId, ...(excludePayout ? { id: { not: excludePayout } } : {}) }, _sum: { amountCents: true } });
  return { earned: earned._sum.amountCents ?? 0, savings: earned._sum.savingsCents ?? 0, available: (earned._sum.amountCents ?? 0) - (paid._sum.amountCents ?? 0) };
}
async function hold(tx: Tx, communityId: string) {
  const recurring = await tx.recurringCharge.findMany({where:{communityId,hoaShareCents:{gt:0}},select:{id:true,status:true,reconciliationHoldReason:true}});
  if(recurring.some(c=>c.reconciliationHoldReason||c.status==="disputed"))return "A recurring payment requires financial reconciliation.";
  const chargeIds=recurring.map(c=>c.id);
  if(await tx.recurringChargeRefund.findFirst({where:{chargeId:{in:chargeIds},status:{not:"succeeded"}}}))return "A recurring refund is still processing.";
  const recurringLines=await tx.recurringChargeLine.findMany({where:{chargeId:{in:chargeIds}},select:{visitId:true}});
  if(await tx.serviceQualityClaim.findFirst({select:{id:true},where:{visitId:{in:recurringLines.map(l=>l.visitId)},resolution:{in:["reported","redo_pending","refund_pending"]}}}))return "A recurring service quality claim is unresolved.";
  const payments = await tx.stripeTestPayment.findMany({ where: { communityId, hoaShareCents: { gt: 0 } }, select: { visitId: true, reconciliationHoldReason: true, status: true } });
  if (payments.some(p => p.reconciliationHoldReason || p.status === "disputed")) return "A resident payment requires financial reconciliation.";
  const visits = payments.map(p => p.visitId);
  if (await tx.stripeTestRefund.findFirst({ where: { visitId: { in: visits }, state: { notIn: ["succeeded", "failed"] } } })) return "A resident refund is still processing.";
  if (await tx.serviceQualityClaim.findFirst({ select:{id:true}, where: { visitId: { in: visits }, resolution: { in: ["reported", "redo_pending", "refund_pending"] } } })) return "A service quality claim is unresolved.";
  return null;
}
function view(row: HoaShareStatement, payout: HoaSharePayout | null, available: number): HoaShareStatementView {
  return { id: row.id, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(), totalCents: row.totalCents, savingsCents: row.savingsCents,
    availableCents: payout ? 0 : Math.max(0, Math.min(row.closingBalanceCents, available)), distributedCents: payout?.status === "paid" ? payout.amountCents : 0,
    closingBalanceCents: row.closingBalanceCents, status: payout?.status === "paid" ? "paid" : payout ? "pending" : row.closingBalanceCents > 0 ? "ready" : "carried",
    paidAt: payout?.paidAt?.toISOString() ?? null, reference: payout?.reference ?? payout?.stripeTransferId ?? null };
}
export async function getHoaShareDashboard(actor: string, communityId: string): Promise<HoaShareDashboard> {
  return db.$transaction(async tx => {
    const community = await access(tx, actor, communityId);
    const balance = await totals(tx, communityId); const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const month = await tx.hoaShareEntry.aggregate({ where: { communityId, createdAt: { gte: start } }, _sum: { amountCents: true, savingsCents: true } });
    const rows = await tx.hoaShareStatement.findMany({ where: { communityId }, orderBy: { periodStart: "desc" }, take: 60 });
    const payouts = await tx.hoaSharePayout.findMany({ where: { communityId } });
    return { communityId, communityName: community.name, rateBps: community.hoaRevenueShareBps, payoutStatus: community.stripeTestHoaPayoutStatus,
      savingsCents: balance.savings, earnedCents: balance.earned, availableCents: balance.available, payoutHoldReason: await hold(tx, communityId),
      currentMonth: start.toISOString().slice(0, 7), monthSavingsCents: month._sum.savingsCents ?? 0, monthEarnedCents: month._sum.amountCents ?? 0,
      statements: rows.map(row => view(row, payouts.find(p => p.statementId === row.id) ?? null, balance.available)) };
  });
}
export async function setHoaShareRate(actor: string, communityId: string, bps: number) {
  enabled(); const fee = Number(process.env.PLATFORM_FEE_BPS ?? "1000");
  if (!Number.isInteger(bps) || bps < 0 || bps > Math.min(1000, fee) || !Number.isInteger(fee)) throw new HoaWorkflowError("HOA share must fit within the platform fee.", 400);
  await db.$transaction(async tx => { const old = await access(tx, actor, communityId, true); await tx.community.update({ where: { id: communityId }, data: { hoaRevenueShareBps: bps } }); await audit(tx, actor, communityId, "hoa_share_rate", { previousBps: old.hoaRevenueShareBps, rateBps: bps }); });
  return getHoaShareDashboard(actor, communityId);
}
function period(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HoaWorkflowError("Use a YYYY-MM statement period.", 400);
  const [year, month] = value.split("-").map(Number); const start = new Date(Date.UTC(year, month - 1, 1)); const end = new Date(Date.UTC(year, month, 1));
  if (year < 2020 || end > new Date()) throw new HoaWorkflowError("Only completed monthly periods can be finalized.", 409);
  return { start, end };
}
async function statement(tx: Tx, communityId: string, value: string) {
  const { start, end } = period(value);
  const old = await tx.hoaShareStatement.findUnique({ where: { communityId_periodStart: { communityId, periodStart: start } } }); if (old) return old;
  const before = await tx.hoaShareEntry.aggregate({ where: { communityId, createdAt: { lt: start } }, _sum: { amountCents: true } });
  const paidBefore = await tx.hoaSharePayout.aggregate({ where: { communityId, status: "paid", paidAt: { lt: start } }, _sum: { amountCents: true } });
  const earned = await tx.hoaShareEntry.aggregate({ where: { communityId, createdAt: { gte: start, lt: end } }, _sum: { amountCents: true, savingsCents: true } });
  const paidMonth = await tx.hoaSharePayout.aggregate({ where: { communityId, status: "paid", paidAt: { gte: start, lt: end } }, _sum: { amountCents: true } });
  const opening = (before._sum.amountCents ?? 0) - (paidBefore._sum.amountCents ?? 0); const net = earned._sum.amountCents ?? 0;
  return tx.hoaShareStatement.create({ data: { communityId, periodStart: start, periodEnd: end, totalCents: net, savingsCents: earned._sum.savingsCents ?? 0, openingBalanceCents: opening, closingBalanceCents: opening + net - (paidMonth._sum.amountCents ?? 0) } });
}
export async function createHoaShareStatement(actor: string, communityId: string, month: string) {
  enabled(); return db.$transaction(async tx => { await access(tx, actor, communityId, true); const row = await statement(tx, communityId, month); return view(row, await tx.hoaSharePayout.findUnique({ where: { statementId: row.id } }), (await totals(tx, communityId)).available); });
}
export async function getHoaShareStatement(actor: string, communityId: string, statementId: string): Promise<HoaShareStatementExport> {
  return db.$transaction(async tx => { const community = await access(tx, actor, communityId); const row = await tx.hoaShareStatement.findUnique({ where: { id: statementId } });
    if (!row || row.communityId !== communityId) throw new HoaWorkflowError("Statement not found.", 404);
    if (await tx.hoaShareEntry.count({ where: { communityId, createdAt: { gte: row.periodStart, lt: row.periodEnd } } }) > 10000) throw new HoaWorkflowError("Statement exceeds the export limit; contact support for the complete ledger.", 409);
    const entries = await tx.hoaShareEntry.findMany({ where: { communityId, createdAt: { gte: row.periodStart, lt: row.periodEnd } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return { ...view(row, await tx.hoaSharePayout.findUnique({ where: { statementId } }), (await totals(tx, communityId)).available), communityId, communityName: community.name, openingBalanceCents: row.openingBalanceCents,
      lines: entries.map(e => ({ date: e.createdAt.toISOString(), kind: e.kind, amountCents: e.amountCents, savingsCents: e.savingsCents })) };
  });
}
async function reserve(tx: Tx, actor: string, communityId: string, statementId: string, method: string, reference: string | null) {
  const community = await access(tx, actor, communityId, true);
  const row = await tx.hoaShareStatement.findUnique({ where: { id: statementId } }); if (!row || row.communityId !== communityId) throw new HoaWorkflowError("Statement not found.", 404);
  const old = await tx.hoaSharePayout.findUnique({ where: { statementId } });
  if (old) { if (old.method !== method || old.reference !== reference) throw new HoaWorkflowError("Statement payment identity cannot change.", 409); return old; }
  const blocked = await hold(tx, communityId); if (blocked) throw new HoaWorkflowError(blocked, 409);
  const amount = Math.min(row.closingBalanceCents, (await totals(tx, communityId)).available);
  if (amount <= 0) throw new HoaWorkflowError("There is no positive HOA balance to pay.", 409);
  if (method === "stripe" && (!community.stripeTestHoaAccountId || community.stripeTestHoaPayoutStatus !== "active")) throw new HoaWorkflowError("Finish HOA sandbox payout setup.", 409);
  const payout = await tx.hoaSharePayout.create({ data: { id: randomUUID(), statementId, communityId, actorUserId: actor, method, amountCents: amount, reference, accountId: method === "stripe" ? community.stripeTestHoaAccountId : null } });
  await audit(tx, actor, communityId, "hoa_share_reserved", { statementId, payoutId: payout.id, amountCents: amount, method }); return payout;
}
export async function markHoaShareStatementPaid(actor: string, communityId: string, statementId: string, reference: string) {
  enabled(); reference = reference.trim(); if (!reference || reference.length > 200) throw new HoaWorkflowError("Enter the manual payment reference (maximum 200 characters).", 400);
  await db.$transaction(async tx => { const op = await reserve(tx, actor, communityId, statementId, "manual", reference); if (op.status === "paid") return;
    await tx.hoaSharePayout.update({ where: { id: op.id }, data: { status: "paid", paidAt: new Date() } }); await audit(tx, actor, communityId, "hoa_share_manual_paid", { payoutId: op.id, amountCents: op.amountCents, reference }); });
  return getHoaShareStatement(actor, communityId, statementId);
}
const objectId = (v: string | { id: string } | null) => typeof v === "string" ? v : v?.id;
function assertTransfer(t: Stripe.Transfer, op: HoaSharePayout, group: string) {
  if (t.transfer_group !== group || t.livemode !== false || t.currency !== "usd" || t.amount !== op.amountCents || objectId(t.destination) !== op.accountId || t.metadata.bundleenHoaPayoutId !== op.id || t.metadata.bundleenCommunityId !== op.communityId || t.metadata.bundleenStatementId !== op.statementId || t.reversed || t.amount_reversed) throw new HoaWorkflowError("HOA transfer requires reconciliation.", 409);
}
export async function payoutHoaShareStatement(actor: string, communityId: string, statementId: string) {
  const stripe = stripeClient(); let op = await db.$transaction(tx => reserve(tx, actor, communityId, statementId, "stripe", null));
  if (op.status === "paid") return getHoaShareStatement(actor, communityId, statementId);
  const frozenStatement = await db.hoaShareStatement.findUniqueOrThrow({ where: { id: statementId } });
  const group = `hoa_${communityId}_${frozenStatement.periodStart.toISOString().slice(0, 7)}`;
  let transfer: Stripe.Transfer | undefined;
  if (op.stripeTransferId) transfer = await stripe.transfers.retrieve(op.stripeTransferId);
  else { const list = await stripe.transfers.list({ transfer_group: group, limit: 100 }); const matches = list.data.filter(t => t.metadata.bundleenHoaPayoutId === op.id);
    if (list.has_more || matches.length > 1 || list.data.length !== matches.length) throw new HoaWorkflowError("HOA transfer history requires reconciliation.", 409); transfer = matches[0]; }
  if (!transfer) {
    const account = await stripe.accounts.retrieve(op.accountId!);
    if (account.id !== op.accountId || account.metadata?.bundleenCommunityId !== communityId || account.requirements?.disabled_reason || account.requirements?.past_due?.length || !account.payouts_enabled || account.capabilities?.transfers !== "active") throw new HoaWorkflowError("HOA payout account is not ready.", 409);
    await db.$transaction(async tx => { await access(tx, actor, communityId, true); const current = await tx.hoaSharePayout.findUniqueOrThrow({ where: { id: op.id } });
      const blocked = await hold(tx, communityId); if (blocked) throw new HoaWorkflowError(blocked, 409);
      if ((await totals(tx, communityId, op.id)).available < op.amountCents) throw new HoaWorkflowError("Refunds changed this reserved balance; reconciliation is required.", 409);
      if (current.attemptedAt && Date.now() - current.attemptedAt.getTime() > WINDOW) throw new HoaWorkflowError("Uncertain HOA transfer needs reconciliation.", 409);
      if (!current.attemptedAt) await tx.hoaSharePayout.update({ where: { id: op.id }, data: { attemptedAt: new Date() } });
    });
    transfer = await db.$transaction(async tx => { await access(tx, actor, communityId, true); const current = await tx.hoaSharePayout.findUniqueOrThrow({ where: { id: op.id } });
      const blocked = await hold(tx, communityId); if (blocked) throw new HoaWorkflowError(blocked, 409);
      if (!current.attemptedAt || Date.now() - current.attemptedAt.getTime() > WINDOW || (await totals(tx, communityId, op.id)).available < op.amountCents) throw new HoaWorkflowError("HOA transfer needs reconciliation.", 409);
      return stripe.transfers.create({ amount: op.amountCents, currency: "usd", destination: op.accountId!, transfer_group: group, metadata: { bundleenHoaPayoutId: op.id, bundleenCommunityId: communityId, bundleenStatementId: statementId } }, { idempotencyKey: `hoa_payout_${op.id}` });
    }, { timeout: 15000 });
  }
  assertTransfer(transfer, op, group);
  await db.$transaction(async tx => { await access(tx, actor, communityId, true); op = await tx.hoaSharePayout.findUniqueOrThrow({ where: { id: op.id } });
    if (op.stripeTransferId && op.stripeTransferId !== transfer.id) throw new HoaWorkflowError("HOA transfer identity changed.", 409);
    if (op.status !== "paid") { await tx.hoaSharePayout.update({ where: { id: op.id }, data: { stripeTransferId: transfer.id, status: "paid", paidAt: new Date() } }); await audit(tx, actor, communityId, "hoa_share_stripe_paid", { payoutId: op.id, amountCents: op.amountCents }); }
  });
  return getHoaShareStatement(actor, communityId, statementId);
}
function origin() { const value = process.env.STRIPE_TEST_APP_URL; if (!value) throw new HoaWorkflowError("Sandbox application URL is missing.", 503); const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new HoaWorkflowError("Sandbox application URL is invalid.", 503); return url.origin; }
export async function createHoaShareAccountLink(actor: string, communityId: string) {
  const stripe = stripeClient(); const app = origin(); let community = await db.$transaction(tx => access(tx, actor, communityId));
  if (!community.stripeTestHoaAccountId) { const account = await stripe.accounts.create({ type: "express", capabilities: { transfers: { requested: true } }, metadata: { bundleenCommunityId: communityId } }, { idempotencyKey: `hoa_account_${communityId}` });
    community = await db.$transaction(async tx => { const current = await access(tx, actor, communityId); if (current.stripeTestHoaAccountId && current.stripeTestHoaAccountId !== account.id) throw new HoaWorkflowError("HOA account changed.", 409); return tx.community.update({ where: { id: communityId }, data: { stripeTestHoaAccountId: account.id, stripeTestHoaPayoutStatus: "pending" } }); });
  }
  const account = await stripe.accounts.retrieve(community.stripeTestHoaAccountId!); if (account.id !== community.stripeTestHoaAccountId || account.metadata?.bundleenCommunityId !== communityId) throw new HoaWorkflowError("HOA account identity changed.", 409);
  const actorUser = await db.user.findUnique({ where: { id: actor }, select: { role: true } });
  const path = actorUser?.role === "admin" ? `/app/admin/communities/${encodeURIComponent(communityId)}` : "/app/hoa/dashboard";
  const link = await stripe.accountLinks.create({ account: account.id, type: "account_onboarding", return_url: `${app}${path}?hoaPayoutSetup=return`, refresh_url: `${app}${path}?hoaPayoutSetup=refresh` });
  await db.$transaction(async tx => { const current = await access(tx, actor, communityId); if (current.stripeTestHoaAccountId !== account.id) throw new HoaWorkflowError("HOA account changed.", 409); });
  if (new URL(link.url).hostname !== "connect.stripe.com" || new URL(link.url).protocol !== "https:") throw new HoaWorkflowError("Unexpected payout setup URL.", 409); return { url: link.url };
}
export async function refreshHoaShareAccount(actor: string, communityId: string) {
  const stripe = stripeClient(); const community = await db.$transaction(tx => access(tx, actor, communityId)); if (!community.stripeTestHoaAccountId) return { payoutStatus: "not_started" };
  const account = await stripe.accounts.retrieve(community.stripeTestHoaAccountId); if (account.id !== community.stripeTestHoaAccountId || account.metadata?.bundleenCommunityId !== communityId) throw new HoaWorkflowError("HOA account identity changed.", 409);
  const payoutStatus = account.requirements?.disabled_reason || account.requirements?.past_due?.length ? "restricted" : account.payouts_enabled && account.capabilities?.transfers === "active" ? "active" : "pending";
  await db.$transaction(async tx => { const current = await access(tx, actor, communityId); if (current.stripeTestHoaAccountId !== account.id) throw new HoaWorkflowError("HOA account changed.", 409); await tx.community.update({ where: { id: communityId }, data: { stripeTestHoaPayoutStatus: payoutStatus } }); }); return { payoutStatus };
}
export async function generateHoaMonthlyStatements() {
  if (process.env.HOA_REVENUE_SHARE !== "1") return { generated: 0, paid: 0, failed: 0, payoutActorConfigured: false };
  const now = new Date(); const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  // Explicitly configured owner identity, never pick an arbitrary administrator.
  const actor = process.env.HOA_SHARE_PAYOUT_ACTOR_ID?.trim();
  const communities = await db.$transaction(async tx => {
    const id = `monthly:${prior}`;
    await tx.hoaShareJobCursor.upsert({ where: { id }, create: { id }, update: {} });
    await tx.$queryRaw`SELECT "id" FROM "HoaShareJobCursor" WHERE "id"=${id} FOR UPDATE`;
    const cursor = await tx.hoaShareJobCursor.findUniqueOrThrow({ where: { id } });
    const page = (after: string | null) => tx.hoaShareEntry.findMany({ distinct: ["communityId"], where: after ? { communityId: { gt: after } } : {}, select: { communityId: true }, orderBy: { communityId: "asc" }, take: 100 });
    let rows = await page(cursor.lastCommunityId); if (!rows.length && cursor.lastCommunityId) rows = await page(null);
    await tx.hoaShareJobCursor.update({ where: { id }, data: { lastCommunityId: rows.at(-1)?.communityId ?? null } });
    return rows;
  });
  let generated = 0, paid = 0, failed = 0;
  for (const { communityId } of communities) {
    try {
      const row = await db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${communityId} FOR UPDATE`; return statement(tx, communityId, prior); });
      generated++;
      if (!actor) continue;
      // Old uncertain operations retain their original month and account after rollover.
      const pending = await db.hoaSharePayout.findMany({ where: { communityId, method: "stripe", status: "pending" }, orderBy: { updatedAt: "asc" }, take: 20 });
      for (const old of pending) {
        try { const result = await payoutHoaShareStatement(actor, communityId, old.statementId); if (result.status === "paid") paid++; }
        catch { failed++; }
        // Rotate even blocked rows so one old failure cannot starve other attempts.
        await db.hoaSharePayout.update({ where: { id: old.id }, data: { updatedAt: new Date() } });
      }
      const community = await db.community.findUnique({ where: { id: communityId } });
      if (community?.stripeTestHoaPayoutStatus !== "active" || !community.stripeTestHoaAccountId) continue;
      const state = await getHoaShareStatement(actor, communityId, row.id);
      if (!pending.some(old => old.statementId === row.id) && (state.status === "pending" || state.availableCents > 0)) {
        const result = await payoutHoaShareStatement(actor, communityId, row.id);
        if (result.status === "paid") paid++;
      }
    } catch { failed++; }
  }
  return { generated, paid, failed, payoutActorConfigured: Boolean(actor) };
}
