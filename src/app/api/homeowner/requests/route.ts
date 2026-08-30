import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { guardFailureResponse, guardHoaMutation } from "@/lib/server/auth-guard";
import { logUnexpectedFailure } from "@/lib/server/errors";
import {
  createHomeownerRequest,
  getRequestEligibility,
  HomeownerRequestError,
  listHomeownerRequests,
} from "@/lib/server/homeowner-requests";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { fieldErrors } from "@/lib/validation/profile";
import {
  createHomeownerRequestSchema,
  MAX_REQUEST_BODY_BYTES,
} from "@/lib/validation/homeowner-requests";

/**
 * The canonical contract for individual homeowner service requests.
 *
 * `GET`  → the caller's own requests, plus whether they may open another and
 *          what to do if not. The page needs both to avoid rendering a form
 *          that can only fail, and one round trip is enough for both.
 * `POST` → creates exactly one request and answers `201`.
 *
 * Identity, community, and status are derived from the verified session inside
 * `lib/server/homeowner-requests.ts`. No query parameter and no body field here
 * can name a different owner or community.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    const [requests, eligibility] = await Promise.all([
      listHomeownerRequests(authorized.user.id),
      getRequestEligibility(authorized.user),
    ]);
    return NextResponse.json({ requests, eligibility });
  } catch (error) {
    const reference = logUnexpectedFailure("homeowner:request list", error);
    return NextResponse.json(
      { error: "We could not load your requests. Please try again.", reference },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  // Rate limited per account, like every other customer write in the app.
  const failure = await guardHoaMutation(authorized.user.id);
  if (failure) return guardFailureResponse(failure);

  const body = await readJsonBody(request, MAX_REQUEST_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = createHomeownerRequestSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const created = await createHomeownerRequest(authorized.user, parsed.data);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    if (error instanceof HomeownerRequestError) {
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    }
    const reference = logUnexpectedFailure("homeowner:request create", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong on our end and your request was not saved. Please try again.",
        reference,
      },
      { status: 500 },
    );
  }
}
