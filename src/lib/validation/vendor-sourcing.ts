import { z } from "zod";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";
import { VENDOR_LEAD_SOURCES, VENDOR_LEAD_STATUSES } from "@/lib/vendor-sourcing-types";

export const MAX_VENDOR_BODY_BYTES = 512 * 1024;
export const MAX_VENDOR_IMPORT_ROWS = 1000;
export const MAX_VENDOR_INVITE_BATCH = 25;
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
export const vendorLeadSchema = z.object({
  businessName: z.string().trim().min(1).max(160), categories: z.array(z.enum(SERVICE_CATEGORIES)).min(1).max(14),
  licenseNumber: optionalText(40), licenseClasses: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  licenseStatus: z.enum(["active", "inactive", "unknown"]).default("unknown"),
  licenseJurisdiction: z.string().trim().min(2).max(8).default("CA"),
  licenseExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  workersCompOnFile: z.boolean().nullable().optional(), bondOnFile: z.boolean().nullable().optional(),
  phone: optionalText(40), email: z.string().trim().email().max(254).nullable().optional().transform((value) => value?.toLowerCase() ?? null),
  website: z.string().url().max(300).refine((value) => { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.hash; }, "Use an HTTP(S) website without credentials or fragments.").nullable().optional(), city: optionalText(100), region: optionalText(40),
  postalCode: optionalText(20), county: optionalText(100),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  source: z.enum(VENDOR_LEAD_SOURCES).default("admin"), status: z.enum(VENDOR_LEAD_STATUSES).optional(),
  notes: optionalText(2000), contactConfirmed: z.boolean().default(false),
}).strict().refine((value) => (value.latitude == null) === (value.longitude == null), "Supply both coordinates or neither.");
export type VendorLeadInput = z.infer<typeof vendorLeadSchema>;
export const vendorReferralSchema = z.object({
  businessName: z.string().trim().min(1).max(160), phone: optionalText(40),
  email: z.string().trim().email().max(254).nullable().optional(), notes: optionalText(1000),
}).strict().refine((value) => !!value.phone || !!value.email, "Provide a phone number or email.");
export type VendorReferralInput = z.infer<typeof vendorReferralSchema>;
export const vendorImportSchema = z.object({
  csv: z.string().min(1).max(500_000), targetCounties: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  licenseClasses: z.array(z.string().trim().min(1).max(20)).min(1).max(10).default(["D-35", "C-53"]),
  dryRun: z.boolean().default(true),
}).strict();
export type VendorImportInput = z.infer<typeof vendorImportSchema>;
export const vendorInviteBatchSchema = z.object({
  leadIds: z.array(z.string().min(1).max(64)).max(MAX_VENDOR_INVITE_BATCH).default([]),
  providerUserIds: z.array(z.string().min(1).max(64)).max(MAX_VENDOR_INVITE_BATCH).default([]),
}).strict().refine((value) => value.leadIds.length + value.providerUserIds.length > 0 && value.leadIds.length + value.providerUserIds.length <= MAX_VENDOR_INVITE_BATCH,
  "Select between one and 25 providers or leads.");
export type VendorInviteBatchInput = z.infer<typeof vendorInviteBatchSchema>;
