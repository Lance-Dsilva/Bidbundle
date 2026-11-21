import { hoaShareExportHandler } from "@/lib/server/hoa-share-api";
export const runtime = "nodejs";
export const GET = hoaShareExportHandler(false);
