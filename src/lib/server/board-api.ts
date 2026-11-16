import "server-only";
import { boardWorkflowError } from "@/lib/server/board-review";
import { authorizeRequest } from "@/lib/server/auth";
import { guardHoaMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { readJsonBody } from "@/lib/server/profile";
import { HoaWorkflowError } from "@/lib/server/hoa";
import type { z } from "zod";

export function privateBoardResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
}
export function boardRoute<C>(scope: string, handler: (request: Request, context: C, user: { id: string; email: string }) => Promise<Response>) {
  return async (request: Request, context: C) => {
    try {
      const gate = await authorizeRequest();
      if (!gate.ok) return privateBoardResponse(gate.response);
      if (!["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new HoaWorkflowError("Use Bundleen to make this change.", 403);
        const failure = await guardHoaMutation(gate.user.id);
        if (failure) return privateBoardResponse(guardFailureResponse(failure));
      }
      return privateBoardResponse(await handler(request, context, gate.user));
    } catch (error) { return privateBoardResponse(hoaErrorResponse(scope, boardWorkflowError(error) ?? error)); }
  };
}
export async function readBoardBody<T>(request: Request, schema: z.ZodType<T>) {
  const body = await readJsonBody(request, 32 * 1024);
  if (!body.ok) throw new HoaWorkflowError("Invalid or oversized request body.", body.response.status);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) throw new HoaWorkflowError(parsed.error.issues[0]?.message || "Check the form fields.", 400);
  return parsed.data;
}
