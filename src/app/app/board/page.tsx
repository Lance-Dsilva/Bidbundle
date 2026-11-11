import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { requireUser } from "@/lib/server/auth";
import { listBoardCommunities } from "@/lib/server/board-review";
export const dynamic = "force-dynamic";
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const user = await requireUser("/app/board");
  const query = await searchParams;
  const initialRequestId = typeof query.request === "string" ? query.request : undefined;
  return <BoardWorkspace initialRequestId={initialRequestId} key={user.id} initialCommunities={await listBoardCommunities(user.id)} />;
}
