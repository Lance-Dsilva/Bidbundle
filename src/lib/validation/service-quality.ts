import { z } from "zod";
import { normalizeTicketText } from "./support";

const text = z.string().transform(normalizeTicketText).pipe(z.string().min(10).max(4000));
export const serviceQualityReportSchema = z.object({
  reason: z.enum(["incomplete", "not_as_described", "damage", "other"]),
  description: text,
}).strict();
export const serviceQualityResponseSchema = z.object({ response: text }).strict();
export const serviceQualityResolutionSchema = z.object({
  action: z.enum(["request_redo", "request_refund"]),
  note: text,
}).strict();

export function withinQualityReportWindow(completedAt: Date | null, now: Date): boolean {
  if (!completedAt) return false;
  const elapsed = now.getTime() - completedAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 72 * 60 * 60 * 1000;
}
