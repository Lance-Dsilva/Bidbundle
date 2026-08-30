import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireViewerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { getIssue, setIssueWithdrawal, updateIssue } from "@/lib/server/amenity-issues";
import { db } from "@/lib/server/db";
import { issueUpdateSchema, issueWithdrawSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ issueId: string }> };

async function communityOf(issueId: string): Promise<string | null> {
  const issue = await db.amenityIssue.findUnique({
    where: { id: issueId },
    select: { communityId: true },
  });
  return issue?.communityId ?? null;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { issueId } = await context.params;
  const communityId = await communityOf(issueId);
  if (!communityId) {
    return NextResponse.json({ error: "That report was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(communityId);
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await getIssue(gate.scope, issueId));
  } catch (error) {
    return amenityErrorResponse("issue detail", error);
  }
}

/**
 * Staff status, priority, and assignment changes — or, for the reporter, a
 * withdrawal or reopen. The service decides which, from the resolved scope.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { issueId } = await context.params;
  const communityId = await communityOf(issueId);
  if (!communityId) {
    return NextResponse.json({ error: "That report was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(communityId, "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;

  const withdrawal = issueWithdrawSchema.safeParse(body.value);
  if (withdrawal.success) {
    try {
      await setIssueWithdrawal(gate.scope, issueId, withdrawal.data.action);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return amenityErrorResponse("issue withdrawal", error);
    }
  }

  const parsed = issueUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await updateIssue(gate.scope, issueId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("issue update", error);
  }
}
