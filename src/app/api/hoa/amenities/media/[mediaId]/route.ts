import { NextResponse } from "next/server";

import { amenityErrorResponse, requireViewerScope } from "@/lib/server/amenity-api";
import {
  canViewMedia,
  loadMediaForAccess,
  readMediaBytes,
  removeMedia,
} from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ mediaId: string }> };

/**
 * Authenticated image delivery.
 *
 * This route exists so no amenity or complaint photo is ever reachable by URL
 * alone. Authorization runs on *every* request against the live database, so
 * removing a resident from the HOA revokes their access to its photos
 * immediately — which a signed or unguessable storage URL handed to the
 * browser could never do.
 *
 * `private, no-store` keeps a shared cache from holding a copy that outlives
 * the membership that justified it.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { mediaId } = await context.params;

  const asset = await loadMediaForAccess(mediaId);
  // A missing asset and an unauthorized one answer identically, so the
  // endpoint cannot be used to confirm that a photo exists.
  if (!asset) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(asset.communityId);
  if (!gate.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (
    !canViewMedia(asset, {
      communityId: gate.scope.communityId,
      userId: gate.scope.userId,
      canManage: gate.scope.canManage,
    })
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const payload = await readMediaBytes(asset);
  if (!payload) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new NextResponse(payload.bytes, {
    status: 200,
    headers: {
      "Content-Type": payload.contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      // The bytes are a re-encoded image, but a browser that sniffs its way to
      // something else would be executing it on this origin.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Removes a photo. The uploader, or scoped staff moderating their HOA. */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { mediaId } = await context.params;

  const asset = await loadMediaForAccess(mediaId);
  if (!asset) return NextResponse.json({ ok: true });

  const gate = await requireViewerScope(asset.communityId, "mutation");
  if (!gate.ok) return gate.response;

  if (
    !canViewMedia(asset, {
      communityId: gate.scope.communityId,
      userId: gate.scope.userId,
      canManage: gate.scope.canManage,
    })
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    await removeMedia(mediaId, gate.scope.userId, gate.scope.canManage);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("media removal", error);
  }
}
