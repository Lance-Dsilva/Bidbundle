import "server-only";
import { z } from "zod";
import { requireAdminOwner, requireAdminOwnerMutation } from "@/lib/server/admin-api";
import { requireHoaUser, requireHoaMutation, readHoaBody, validationErrorResponse, hoaErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { getHoaShareDashboard, setHoaShareRate, createHoaShareAccountLink, refreshHoaShareAccount, createHoaShareStatement, markHoaShareStatementPaid, payoutHoaShareStatement, getHoaShareStatement } from "@/lib/server/hoa-revenue-share";
import { hoaShareCsv, hoaSharePdf } from "@/lib/server/hoa-share-export";

const id = z.string().min(1).max(128);
const action = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("connect") }),
  z.strictObject({ action: z.literal("refresh") }),
  z.strictObject({ action: z.literal("rate"), rateBps: z.number().int().min(0).max(1000) }),
  z.strictObject({ action: z.literal("statement"), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.strictObject({ action: z.literal("manual"), statementId: id, reference: z.string().trim().min(1).max(200) }),
  z.strictObject({ action: z.literal("payout"), statementId: id }),
]);
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", "private, no-store"); response.headers.set("X-Content-Type-Options", "nosniff"); return response; };
const failure = (error: unknown) => privateResponse(hoaErrorResponse("Association revenue share", error instanceof HoaWorkflowError ? error : new HoaWorkflowError("Association earnings are temporarily unavailable. Refresh before retrying.", 503)));
type Context = { params: Promise<{ communityId: string }> };
export function hoaShareHandlers(admin: boolean) {
  return {
    async GET(_request: Request, context: Context) {
      const gate = await (admin ? requireAdminOwner() : requireHoaUser()); if (!gate.ok) return privateResponse(gate.response);
      try { return privateResponse(Response.json(await getHoaShareDashboard(gate.user.id, (await context.params).communityId))); } catch (error) { return failure(error); }
    },
    async POST(request: Request, context: Context) {
      const gate = await (admin ? requireAdminOwnerMutation() : requireHoaMutation()); if (!gate.ok) return privateResponse(gate.response);
      const body = await readHoaBody(request); if (!body.ok) return privateResponse(body.response);
      const parsed = action.safeParse(body.value); if (!parsed.success) return privateResponse(validationErrorResponse(fieldErrors(parsed.error)));
      const data = parsed.data;
      if (!admin && !["connect", "refresh"].includes(data.action)) return privateResponse(Response.json({ error: "Only the Bundleen owner can manage association payments." }, { status: 403 }));
      try {
        const actor = gate.user.id, community = (await context.params).communityId;
        const result = data.action === "connect" ? await createHoaShareAccountLink(actor, community)
          : data.action === "refresh" ? await refreshHoaShareAccount(actor, community)
          : data.action === "rate" ? await setHoaShareRate(actor, community, data.rateBps)
          : data.action === "statement" ? await createHoaShareStatement(actor, community, data.period)
          : data.action === "manual" ? await markHoaShareStatementPaid(actor, community, data.statementId, data.reference)
          : await payoutHoaShareStatement(actor, community, data.statementId);
        return privateResponse(Response.json(result));
      } catch (error) { return failure(error); }
    },
  };
}
export function hoaShareExportHandler(admin: boolean) {
  return async (request: Request, context: { params: Promise<{ communityId: string; statementId: string }> }) => {
    const gate = await (admin ? requireAdminOwner() : requireHoaUser()); if (!gate.ok) return privateResponse(gate.response);
    const format = new URL(request.url).searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "pdf") return privateResponse(Response.json({ error: "Choose CSV or PDF." }, { status: 400 }));
    try {
      const { communityId, statementId } = await context.params;
      const statement = await getHoaShareStatement(gate.user.id, communityId, statementId);
      const content = format === "csv" ? hoaShareCsv(statement) : new Uint8Array(await hoaSharePdf(statement));
      return privateResponse(new Response(content, { headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="association-statement-${statement.periodStart.slice(0, 7)}.${format}"`,
      } }));
    } catch (error) { return failure(error); }
  };
}
