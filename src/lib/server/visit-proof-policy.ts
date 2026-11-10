import "server-only";
import { SERVICE_CATEGORIES, type ServiceCategory } from "@/lib/service-categories";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

async function requirePolicyAdmin(userId: string) {
  const actor = await db.user.findUnique({ where: { id: userId }, select: { role: true, isVerified: true, email: true, adminAccess: { select: { status: true, email: true, isStaffAccount: true } } } });
  if (actor?.role !== "admin" || !actor.isVerified || actor.adminAccess?.status !== "active" || actor.adminAccess.isStaffAccount || actor.adminAccess.email !== actor.email.toLowerCase()) throw new HoaWorkflowError("Active Bundleen admin access is required.", 403);
}

export async function listVisitProofPolicies(userId: string) {
  await requirePolicyAdmin(userId);
  const policies = await db.categoryVisitPolicy.findMany({ orderBy: { category: "asc" }, select: { category: true, requiresAfterPhoto: true } });
  return { policies };
}

export async function updateVisitProofPolicy(userId: string, category: ServiceCategory, requiresAfterPhoto: boolean) {
  await requirePolicyAdmin(userId);
  if (!SERVICE_CATEGORIES.includes(category)) throw new HoaWorkflowError("Choose a supported service category.", 400);
  try {
    await db.categoryVisitPolicy.update({ where: { category }, data: { requiresAfterPhoto, updatedByUserId: userId } });
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
    if ([failure.code, failure.meta?.code, failure.meta?.driverAdapterError?.cause?.originalCode].some((code) => code && ["P1710", "P1711", "P1712", "P2025", "40001", "40P01"].includes(code))) throw new HoaWorkflowError("The policy or your access changed. Refresh before trying again.", 409);
    throw error;
  }
  return listVisitProofPolicies(userId);
}
