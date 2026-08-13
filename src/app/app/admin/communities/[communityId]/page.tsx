import Link from "next/link";
import { notFound } from "next/navigation";

import { CommunityDetailWorkspace } from "@/components/admin/CommunityDetailWorkspace";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { getCommunityDetail } from "@/lib/server/communities";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ communityId: string }> };

/**
 * Community detail.
 *
 * The initial payload is read on the server so the page renders complete;
 * the workspace below it takes over for mutations and holds the refreshed
 * payload each endpoint returns, which avoids a re-fetch after every action.
 */
export default async function AdminCommunityDetailPage({ params }: PageProps) {
  await requireRole(["admin"], "/app/admin/communities");

  const { communityId } = await params;
  const detail = await getCommunityDetail(communityId);
  if (!detail) notFound();

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title={detail.community.name}
        subtitle={
          detail.community.type === "hoa"
            ? "Official HOA community"
            : `Location-based neighborhood · ${detail.community.radiusMiles ?? "—"} mi radius`
        }
        action={
          <Link
            href="/app/admin/communities"
            className="text-[12px] font-semibold"
            style={{ color: "var(--teal-800)" }}
          >
            ← All communities
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-5xl px-4 py-7 pb-24">
        <CommunityDetailWorkspace initialDetail={detail} />
      </div>
    </div>
  );
}
