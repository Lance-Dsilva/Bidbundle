import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireViewerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { addIssueMessage } from "@/lib/server/amenity-issues";
import { db } from "@/lib/server/db";
import { issueMessageSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ issueId: string }> };

/**
 * Adds a message to the thread.
 *
 * `internal: true` is honoured only for scoped staff; a resident who sends it
 * writes an ordinary, reporter-visible message.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { issueId } = await context.params;
  const issue = await db.amenityIssue.findUnique({
    where: { id: issueId },
    select: { communityId: true },
  });
  if (!issue) {
    return NextResponse.json({ error: "That report was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(issue.communityId, "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = issueMessageSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await addIssueMessage(
      gate.scope,
      issueId,
      parsed.data.body,
      parsed.data.internal === true,
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return amenityErrorResponse("issue message", error);
  }
}
