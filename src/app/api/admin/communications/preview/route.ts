import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminPermission,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { previewBroadcastAudience } from "@/lib/server/communications";
import {
  BROADCAST_SEGMENTS,
  BROADCAST_SEVERITIES,
  MAX_BROADCAST_BODY_BYTES,
} from "@/lib/validation/communications";
import { fieldErrors } from "@/lib/validation/profile";
import { z } from "zod";

/**
 * Live recipient count and sample for the compose screen.
 *
 * Recalculated here on every call: the number an admin confirms must be the
 * server's answer at that moment, not a figure the browser has been carrying
 * around since the page loaded.
 */
export const runtime = "nodejs";

const previewSchema = z
  .object({
    audienceSegments: z.array(z.enum(BROADCAST_SEGMENTS)).max(3).default([]),
    severity: z.enum(BROADCAST_SEVERITIES),
    overridesEmailPreference: z.boolean().default(false),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminPermission("communications:draft");
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request, MAX_BROADCAST_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = previewSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    return NextResponse.json({ preview: await previewBroadcastAudience(parsed.data) });
  } catch (error) {
    return adminErrorResponse("broadcast preview", error);
  }
}
