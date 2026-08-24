import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { guardFailureResponse, guardSupportAi } from "@/lib/server/auth-guard";
import {
  generateExplanation,
  isTicketAiAvailable,
  listTicketAiDrafts,
} from "@/lib/server/ai/support-assist";
import { supportErrorResponse } from "@/lib/server/support-api";

/**
 * Internal diagnostic explanations.
 *
 * Admin-only in every direction: there is no customer route that reads
 * `SupportTicketAiDraft`, the customer serializers never touch it, and the
 * database rejects an `explanation` row that claims to have been sent.
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
      explanations: drafts.filter((draft) => draft.kind === "explanation"),
    });
  } catch (error) {
    return adminErrorResponse("ai explanation list", error);
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

  const failure = await guardSupportAi(gate.user.id, ticketId);
  if (failure) return guardFailureResponse(failure);

  try {
    const explanation = await generateExplanation(
      { id: gate.user.id, role: gate.user.role },
      ticketId,
    );
    return NextResponse.json({ explanation }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("ai explanation generate", error);
  }
}
