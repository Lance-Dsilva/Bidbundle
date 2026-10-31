import { CommunityInterestQueue } from "@/components/admin/CommunityInterestQueue";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminCommunityInterestPage() {
  await requireRole(["admin"], "/app/admin/community-interest");
  return <CommunityInterestQueue />;
}
