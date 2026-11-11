import { boardRoute } from "@/lib/server/board-api";
import { getBoardReview } from "@/lib/server/board-review";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { readPrivateCredentialBytes } from "@/lib/server/provider-credentials";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requestId: string; roundId: string; mediaId: string }> };
export const GET = boardRoute<Context>("board credential", async (_request, context, user) => {
  const { requestId, roundId, mediaId } = await context.params;
  const view = await getBoardReview(user.id, requestId);
  const round = view.rounds.find(item => item.id === roundId);
  const proposal = round?.proposals.find(item => item.licenseDocumentId === mediaId || item.insuranceDocumentId === mediaId);
  const unavailable = () => new HoaWorkflowError("Document unavailable.", 404);
  if (!round || round.stale || !["open", "awarded"].includes(round.status) || !proposal) throw unavailable();
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, status: "active", purpose: { in: ["provider_license", "provider_insurance"] } },
    include: { providerProfile: { select: { userId: true, licenseDocumentId: true, insuranceDocumentId: true } } } });
  if (!asset?.providerProfile || asset.providerProfile.userId !== proposal.providerUserId || asset.communityId !== null || asset.storageUrl !== "" ||
      !asset.storagePath.startsWith(`provider-credentials/${asset.providerProfileId}/${asset.purpose}/`)) throw unavailable();
  const currentId = asset.purpose === "provider_license" ? asset.providerProfile.licenseDocumentId : asset.providerProfile.insuranceDocumentId;
  if (currentId !== asset.id) throw unavailable();
  const bytes = await readPrivateCredentialBytes(asset);
  if (!bytes) throw unavailable();
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  return new Response(bytes.stream, { headers: { "Content-Type": bytes.contentType,
    "Content-Disposition": `attachment; filename="${asset.purpose === "provider_license" ? "license" : "insurance"}.${extensions[bytes.contentType] ?? "bin"}"`,
    "Content-Security-Policy": "sandbox" } });
});
