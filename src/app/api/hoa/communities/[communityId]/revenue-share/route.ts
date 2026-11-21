import { hoaShareHandlers } from "@/lib/server/hoa-share-api";
export const runtime = "nodejs";
export const { GET, POST } = hoaShareHandlers(false);
