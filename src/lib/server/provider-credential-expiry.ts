import "server-only";

import { credentialIsCurrent, providerVerificationState } from "@/lib/provider-verification";
import { buildAuditEntry } from "./audit";
import { db } from "./db";
import { buildPreferenceAwareNotificationOps } from "./notifications";
import { nextProviderUpdatedAt, providerWriteSnapshotSelect, providerWriteSnapshotWhere } from "./profile";

const DAY = 86400000;

/** Daily, bounded work. Per-document markers and notification keys prevent repeats. */
export async function sweepProviderCredentialExpirations(now = new Date(), limit = 100) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = await db.mediaAsset.findMany({
    where: { purpose: { in: ["provider_license", "provider_insurance"] }, status: "active", credentialReviewStatus: "approved",
      OR: [
        { credentialExpiresAt: { lt: today } },
        { credentialExpiresAt: { lte: new Date(today.getTime() + 30 * DAY) }, credentialReminder30At: null },
        { credentialExpiresAt: { lte: new Date(today.getTime() + 7 * DAY) }, credentialReminder7At: null },
      ] },
    include: { providerProfile: { select: { ...providerWriteSnapshotSelect, userId: true, user: { select: { email: true } } } } },
    orderBy: [{ credentialExpiresAt: "asc" }, { id: "asc" }], take: Math.min(500, Math.max(1, limit)),
  });
  const processedProviders = new Set<string>();
  let expired = 0;
  let remindersQueued = 0;
  for (const doc of due) {
    let profile = doc.providerProfile;
    if (!profile) continue;
    if (processedProviders.has(profile.id)) profile = await db.providerProfile.findUnique({ where: { id: profile.id },
      select: { ...providerWriteSnapshotSelect, userId: true, user: { select: { email: true } } } });
    if (!profile) continue;
    processedProviders.add(profile.id);
    const kind = doc.purpose === "provider_license" ? "license" : "insurance";
    const currentId = kind === "license" ? profile.licenseDocumentId : profile.insuranceDocumentId;
    if (currentId !== doc.id) continue;
    const expiresOn = doc.credentialExpiresAt?.toISOString().slice(0, 10) ?? "unknown";
    const isExpired = !credentialIsCurrent(doc.credentialExpiresAt, now);
    const state = providerVerificationState({ ...profile, [kind === "license" ? "licenseDocument" : "insuranceDocument"]: doc }, now);
    try {
      if (isExpired) {
        const cleared = kind === "license"
          ? { licenseVerifiedAt: null, licenseVerifiedByUserId: null, licenseVerifiedDocumentChecksum: null, licenseExpiresAt: null }
          : { insuranceVerifiedAt: null, insuranceVerifiedByUserId: null, insuranceVerifiedDocumentChecksum: null,
            insuranceExpiresAt: null, insuranceCoverageCents: null, insuranceAdditionalInsured: false };
        const notices = await buildPreferenceAwareNotificationOps([{ userId: profile.userId, email: profile.user.email,
          emailPolicy: "required", kind: "account", title: `Your ${kind} verification expired`,
          body: `Upload current ${kind} evidence for review. Existing work remains visible; new awards need current approved documents.`,
          linkPath: "/app/provider/profile", dedupeKey: `credential-expired:${doc.id}:${expiresOn}` }]);
        await db.$transaction([
          db.providerProfile.update({ where: { userId: profile.userId, ...providerWriteSnapshotWhere(profile) },
            data: { ...cleared, updatedAt: nextProviderUpdatedAt(profile) } }),
          db.mediaAsset.update({ where: { id: doc.id, credentialReviewStatus: "approved", status: "active" },
            data: { credentialReviewStatus: "pending", credentialReviewReason: `Expired on ${expiresOn} (UTC). Upload current evidence.` } }),
          db.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: profile.userId,
            action: kind === "license" ? "provider_license_revoked" : "provider_insurance_revoked", targetType: "provider",
            targetId: profile.userId, providerUserId: profile.userId, metadata: { reason: "automatic_expiry", documentId: doc.id, expiresOn } }) }),
          ...notices,
        ]);
        expired++;
      } else if (!state[kind]) {
        // A changed claim cannot retain an approved-looking document forever.
        await db.$transaction([
          db.providerProfile.update({ where: { userId: profile.userId, ...providerWriteSnapshotWhere(profile) }, data: { updatedAt: profile.updatedAt } }),
          db.mediaAsset.update({ where: { id: doc.id, credentialReviewStatus: "approved", status: "active" },
            data: { credentialReviewStatus: "pending", credentialReviewReason: "The credential claim changed; upload matching evidence for review." } }),
        ]);
      } else {
        const days = Math.round((doc.credentialExpiresAt!.getTime() - today.getTime()) / DAY);
        const threshold = days <= 7 ? 7 : 30;
        const marker = threshold === 7 ? "credentialReminder7At" : "credentialReminder30At";
        if (doc[marker]) continue;
        const notices = await buildPreferenceAwareNotificationOps([{ userId: profile.userId, email: profile.user.email,
          emailPolicy: "required", kind: "reminder", title: `Your ${kind} document expires soon`,
          body: `Your approved ${kind} document expires on ${expiresOn}, valid through that UTC date. Upload renewed evidence before then.`,
          linkPath: "/app/provider/profile", dedupeKey: `credential-reminder:${doc.id}:${expiresOn}:${threshold}` }]);
        await db.$transaction([
          db.providerProfile.update({ where: { userId: profile.userId, ...providerWriteSnapshotWhere(profile) }, data: { updatedAt: profile.updatedAt } }),
          db.mediaAsset.update({ where: { id: doc.id, status: "active", credentialReviewStatus: "approved", [marker]: null },
            data: { [marker]: now, ...(threshold === 7 && !doc.credentialReminder30At ? { credentialReminder30At: now } : {}) } }),
          ...notices,
        ]);
        remindersQueued++;
      }
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2025") throw error;
      // Another upload/reviewer/worker won. Its transaction owns the outcome.
    }
  }
  return { expired, remindersQueued };
}
