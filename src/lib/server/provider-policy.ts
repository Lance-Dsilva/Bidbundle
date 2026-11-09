import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { requireCommunityManager } from "./market-auth";
import { HoaWorkflowError } from "./hoa";
import { buildAuditEntry } from "./audit";

export const providerPolicySchema = z.object({
  minimumInsuranceCoverageCents: z.number().int().min(0).max(2147483647),
  requiresAdditionalInsured: z.boolean(),
}).strict();

export async function getProviderPolicy(userId: string, communityId: string) {
  const authority = await requireCommunityManager(userId, communityId);
  if (authority.via !== "hoa_manager" && authority.via !== "admin_recovery") throw new HoaWorkflowError("Only the HOA manager or Bundleen administrator can manage provider insurance requirements.", 403);
  const policy = await db.hoaProfile.findUnique({ where: { communityId },
    select: { minimumInsuranceCoverageCents: true, requiresAdditionalInsured: true } });
  if (!policy) throw new HoaWorkflowError("Set up this HOA’s profile before configuring insurance requirements.", 404);
  return policy;
}

export async function updateProviderPolicy(userId: string, communityId: string, input: z.infer<typeof providerPolicySchema>) {
  await getProviderPolicy(userId, communityId);
  try {
  const [, policy] = await db.$transaction([
    db.$executeRaw(Prisma.sql`SELECT bundleen_assert_provider_policy_manager(${userId}, ${communityId})`),
    db.hoaProfile.update({ where: { communityId }, data: input,
      select: { minimumInsuranceCoverageCents: true, requiresAdditionalInsured: true } }),
    db.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: userId, action: "hoa_profile_updated",
      targetType: "hoa_profile", targetId: communityId, communityId,
      metadata: { subject: "provider_insurance_requirements", ...input } }) }),
  ]);
  return policy;
  } catch (error) {
    const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
    if ([value.code, value.meta?.code, value.meta?.driverAdapterError?.cause?.originalCode].includes("P1703")) {
      throw new HoaWorkflowError("Your management access changed before this edit was saved. Reload and try again.", 409);
    }
    throw error;
  }
}
