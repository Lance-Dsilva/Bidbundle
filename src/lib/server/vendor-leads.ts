import "server-only";
import { randomUUID } from "node:crypto";
import type { VendorLead } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { buildAuditEntry } from "@/lib/server/audit";
import { requireVendorAdmin, lockVendorEmail } from "@/lib/server/vendor-core";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { vendorEmailDigest } from "@/lib/server/vendor-invitation-tokens";
import { parseCslbCsv, normalizeVendorClass } from "@/lib/server/vendor-cslb";
import { requireCommunityManager } from "@/lib/server/market-auth";
import { normalizeServiceTrades } from "@/lib/service-categories";
import type { AdminVendorLead, VendorLeadSource, VendorLeadStatus } from "@/lib/vendor-sourcing-types";
import { vendorLeadSchema, vendorImportSchema, vendorReferralSchema, type VendorLeadInput, type VendorImportInput, type VendorReferralInput } from "@/lib/validation/vendor-sourcing";

export function serializeVendorLead(row: VendorLead): AdminVendorLead {
  return { id: row.id, businessName: row.businessName, categories: normalizeServiceTrades(row.categories),
    licenseNumber: row.licenseNumber, licenseJurisdiction: row.licenseJurisdiction, licenseClasses: row.licenseClasses, licenseStatus: row.licenseStatus,
    licenseExpiresAt: row.licenseExpiresAt?.toISOString() ?? null, workersCompOnFile: row.workersCompOnFile, bondOnFile: row.bondOnFile,
    phone: row.phone, email: row.email, website: row.website, city: row.city, region: row.region, postalCode: row.postalCode, county: row.county,
    latitude: row.latitude, longitude: row.longitude, source: row.source as VendorLeadSource, status: row.status as VendorLeadStatus,
    contactConfirmed: row.contactConfirmed, convertedProviderUserId: row.convertedProviderUserId, lastInvitedAt: row.lastInvitedAt?.toISOString() ?? null, notes: row.notes };
}
const nameKey = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
const phoneKey = (value: string | null) => { const digits = value?.replace(/\D/g, "") ?? ""; return digits.length === 10 ? `1${digits}` : digits || null; };
export async function listVendorLeads(actorId: string, filters: { search?: string; category?: string; status?: string } = {}) {
  await requireVendorAdmin(actorId);
  const rows = await db.vendorLead.findMany({ where: {
    ...(filters.category ? { categories: { has: filters.category } } : {}), ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search ? { businessName: { contains: filters.search.slice(0, 160), mode: "insensitive" as const } } : {}),
  }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 200 });
  return { leads: rows.map(serializeVendorLead) };
}
export async function upsertVendorLead(actorId: string, raw: VendorLeadInput, id?: string) {
  await requireVendorAdmin(actorId);
  const parsed = vendorLeadSchema.safeParse(raw);
  if (!parsed.success) throw new VendorSourcingError("Check the vendor lead fields.", 400);
  const input = parsed.data;
  let old = id ? await db.vendorLead.findUnique({ where: { id } }) : input.licenseNumber ? await db.vendorLead.findFirst({ where: { licenseJurisdiction: input.licenseJurisdiction.toUpperCase(), licenseNumber: input.licenseNumber } }) : null;
  if (!old && !id) {
    const phone = phoneKey(input.phone), domain = input.email?.split("@")[1];
    const alternatives = [...(phone ? [{ phoneNormalized: phone }] : []), ...(domain ? [{ emailDomain: domain }] : [])];
    if (alternatives.length) old = await db.vendorLead.findFirst({ where: { nameKey: nameKey(input.businessName), OR: alternatives } });
  }
  if (id && !old) throw new VendorSourcingError("Vendor lead not found.", 404);
  const email = input.email ?? null;
  const data = { ...input, licenseClasses: input.licenseClasses.map(normalizeVendorClass), nameKey: nameKey(input.businessName), phoneNormalized: phoneKey(input.phone),
    licenseJurisdiction: input.licenseJurisdiction.toUpperCase(), licenseExpiresAt: input.licenseExpiresAt ? new Date(input.licenseExpiresAt) : null,
    email, emailDigest: email ? vendorEmailDigest(email) : null, emailDomain: email?.split("@")[1] ?? null,
    status: old && ["unsubscribed", "bounced", "signed_up"].includes(old.status) ? old.status : input.status === "declined" ? "declined" : old?.status ?? "new",
    contactConfirmed: !!email && input.contactConfirmed,
  };
  const lead = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT bundleen_assert_vendor_admin(${actorId})`;
    for (const digest of [...new Set([old?.emailDigest, data.emailDigest].filter((value): value is string => !!value))].sort()) await lockVendorEmail(tx, digest);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'vendor-name:' + data.nameKey}, 0))`;
    if (!old) {
      const duplicates = await tx.vendorLead.findFirst({ where: { OR: [
        ...(data.licenseNumber ? [{ licenseJurisdiction: data.licenseJurisdiction, licenseNumber: data.licenseNumber }] : []),
        { nameKey: data.nameKey, OR: [...(data.phoneNormalized ? [{ phoneNormalized: data.phoneNormalized }] : []), ...(data.emailDomain ? [{ emailDomain: data.emailDomain }] : [])] },
      ] } });
      if (duplicates) throw new VendorSourcingError("A matching vendor was added. Refresh before editing it.", 409);
    }
    const saved = old ? await tx.vendorLead.update({ where: { id: old.id, updatedAt: old.updatedAt }, data })
      : await tx.vendorLead.create({ data: { ...data, id: randomUUID(), createdByUserId: actorId } });
    await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: actorId, action: "vendor_lead_updated", targetType: "vendor_lead", targetId: saved.id, metadata: { category: saved.categories.join(","), changedFields: Object.keys(data) } }) });
    return saved;
  });
  return { lead: serializeVendorLead(lead) };
}
export async function importCslbLeads(actorId: string, raw: VendorImportInput) {
  await requireVendorAdmin(actorId);
  const validated = vendorImportSchema.safeParse(raw);
  if (!validated.success) throw new VendorSourcingError("Check CSV import options.", 400);
  const input = validated.data, parsed = parseCslbCsv(input);
  const existing = await db.vendorLead.findMany({ where: { licenseJurisdiction: "CA", licenseNumber: { in: parsed.records.map((row) => row.licenseNumber) } } });
  const byLicense = new Map(existing.map((row) => [row.licenseNumber!, row]));
  const seen = new Set<string>(); let importedCount = 0, updatedCount = 0, duplicateCount = 0;
  const writes = [];
  for (const row of parsed.records) {
    if (seen.has(row.licenseNumber)) { duplicateCount++; continue; } seen.add(row.licenseNumber);
    const old = byLicense.get(row.licenseNumber);
    if (!old && !row.eligibleForImport) continue;
    if (old) updatedCount++; else importedCount++;
    const { eligibleForImport: _eligible, reason: _reason, row: _line, ...license } = row;
    const data = { ...license, nameKey: nameKey(row.businessName), phoneNormalized: phoneKey(row.phone) };
    if (!input.dryRun) writes.push(old ? db.vendorLead.update({ where: { id: old.id }, data }) : db.vendorLead.create({ data: {
      ...data, id: randomUUID(), source: "cslb", licenseJurisdiction: "CA", createdByUserId: actorId,
      // Government exports contain no email; confirmed contact and lifecycle are never imported.
    } }));
  }
  if (!input.dryRun) await db.$transaction([
    db.$executeRaw`SELECT bundleen_assert_vendor_admin(${actorId})`, ...writes,
    db.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: actorId, action: "vendor_leads_imported", targetType: "vendor_lead", targetId: randomUUID(), metadata: { importedCount, updatedCount, duplicateCount } }) }),
  ]);
  return { dryRun: input.dryRun, importedCount, updatedCount, duplicateCount, excluded: parsed.excluded, rowsConsidered: parsed.records.length + parsed.excluded.filter((row) => !parsed.records.some((record) => record.row === row.row)).length };
}
export async function addVendorReferral(actorId: string, requestId: string, raw: VendorReferralInput) {
  const parsed = vendorReferralSchema.safeParse(raw);
  if (!parsed.success) throw new VendorSourcingError("Provide a vendor name and contact.", 400);
  const request = await db.hoaServiceRequest.findUnique({ where: { id: requestId }, include: { community: true } });
  if (!request || request.community.status !== "active" || !["collecting_interest", "open_for_bids"].includes(request.status)) throw new VendorSourcingError("This request is not accepting vendor referrals.", 404);
  const member = await db.communityMembership.findFirst({ where: { communityId: request.communityId, userId: actorId, status: "active" } });
  let manager = false;
  if (!member) { await requireCommunityManager(actorId, request.communityId); manager = true; }
  const source = manager ? "hoa_referral" : "resident_referral";
  const phoneNormalized = phoneKey(parsed.data.phone);
  const email = parsed.data.email?.toLowerCase() ?? null;
  const old = await db.vendorLead.findFirst({ where: { nameKey: nameKey(parsed.data.businessName), OR: [
    ...(phoneNormalized ? [{ phoneNormalized }] : []), ...(email ? [{ emailDomain: email.split("@")[1] }] : []),
  ] } });
  const lead = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${requestId} FOR UPDATE`;
    if (await tx.vendorLeadReferral.count({ where: { requestId, createdByUserId: actorId } }) >= 5) throw new VendorSourcingError("At most five vendor referrals per person and request.", 429);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'vendor-name:' + nameKey(parsed.data.businessName)}, 0))`;
    const concurrent = old ?? await tx.vendorLead.findFirst({ where: { nameKey: nameKey(parsed.data.businessName), OR: [
      ...(phoneNormalized ? [{ phoneNormalized }] : []), ...(email ? [{ emailDomain: email.split("@")[1] }] : []),
    ] } });
    const saved = concurrent ?? await tx.vendorLead.create({ data: { id: randomUUID(), businessName: parsed.data.businessName,
      nameKey: nameKey(parsed.data.businessName), categories: [request.category], source, phone: parsed.data.phone, phoneNormalized,
      email, emailDigest: email ? vendorEmailDigest(email) : null, emailDomain: email?.split("@")[1] ?? null, createdByUserId: actorId,
      notes: parsed.data.notes, contactConfirmed: false } });
    await tx.vendorLeadReferral.upsert({ where: { leadId_requestId_createdByUserId: { leadId: saved.id, requestId, createdByUserId: actorId } },
      create: { id: randomUUID(), leadId: saved.id, requestId, createdByUserId: actorId, source }, update: {} });
    await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: actorId, action: "vendor_referral_added", targetType: "vendor_lead", targetId: saved.id, communityId: request.communityId, metadata: { category: request.category } }) });
    return saved;
  });
  // Residents receive only their own submitted contact, never another referrer's private notes/contact changes.
  return { lead: { id: lead.id, businessName: parsed.data.businessName, phone: parsed.data.phone, email, status: "new" } };
}
