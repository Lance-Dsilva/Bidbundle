import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { guardFailureResponse, guardSupportAi } from "@/lib/server/auth-guard";
import {
  approveAndSendDraft,
  discardDraft,
  generateReplyDraft,
  isTicketAiAvailable,
  listTicketAiDrafts,
} from "@/lib/server/ai/support-assist";
import { readJsonBody } from "@/lib/server/profile";
import { supportErrorResponse } from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import {
  aiDraftApprovalSchema,
  aiDraftDiscardSchema,
  MAX_SUPPORT_BODY_BYTES,
} from "@/lib/validation/support";

/**
 * Customer-reply drafting.
 *
 * `POST` prepares a draft and nothing else — it never sends. `PUT` is the
 * separate, explicit human approval that posts the admin's own final text.
 * There is no path here by which a model output reaches a customer without an
 * admin deliberately calling `PUT` with the text they can see on screen.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { ticketId } = await context.params;

  try {
    const drafts = await listTicketAiDrafts(ticketId);
    return NextResponse.json({
      available: isTicketAiAvailable(),
      drafts: drafts.filter((draft) => draft.kind === "reply"),
    });
  } catch (error) {
    return adminErrorResponse("ai draft list", error);
  }
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { ticketId } = await context.params;

  if (!isTicketAiAvailable()) {
    return NextResponse.json(
      {
        error:
          "AI assistance is not configured for this environment. Set OPENAI_API_KEY to enable it.",
        available: false,
      },
      { status: 503 },
    );
  }

  // Per-admin, per-ticket: this is both the cost control and the duplicate
  // -click guard, so a double submit costs one generation, not two.
  const failure = await guardSupportAi(gate.user.id, ticketId);
  if (failure) return guardFailureResponse(failure);

  try {
    const draft = await generateReplyDraft(
      { id: gate.user.id, role: gate.user.role },
      ticketId,
    );
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("ai draft generate", error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_SUPPORT_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = aiDraftApprovalSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    const ticket = await approveAndSendDraft(
      { id: gate.user.id, name: gate.user.name },
      ticketId,
      parsed.data,
    );
    return NextResponse.json({ ticket });
  } catch (error) {
    return supportErrorResponse("ai draft approve", error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_SUPPORT_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = aiDraftDiscardSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    await discardDraft(gate.user.id, ticketId, parsed.data.draftId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return supportErrorResponse("ai draft discard", error);
  }
}
