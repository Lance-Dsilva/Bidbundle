import "server-only";
import { NextResponse } from "next/server";
import { hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import { readJsonBody } from "@/lib/server/profile";
import { fieldErrors } from "@/lib/validation/profile";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import type { z } from "zod";

export function vendorResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Referrer-Policy", "no-referrer");
  const vary = new Set((response.headers.get("Vary") ?? "").split(",").map(x => x.trim()).filter(Boolean));
  vary.add("Cookie"); vary.add("Authorization"); response.headers.set("Vary", [...vary].join(", "));
  return response;
}

export function vendorHandler<C>(scope: string, handler: (request: Request, context: C) => Promise<Response>, allowExternal = false) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      if (!allowExternal && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
          return vendorResponse(NextResponse.json({ error: "Use Bundleen to make this change." }, { status: 403 }));
        }
      }
      return vendorResponse(await handler(request, context));
    } catch (error) {
      if (error instanceof VendorSourcingError) return vendorResponse(NextResponse.json({ error: error.message }, { status: error.status }));
      return vendorResponse(hoaErrorResponse(scope, error));
    }
  };
}

export async function readVendorBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = 64 * 1024) {
  const body = await readJsonBody(request, maxBytes);
  if (!body.ok) return body;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { ok: false as const, response: validationErrorResponse(fieldErrors(parsed.error)) };
  return { ok: true as const, value: parsed.data };
}

export async function readVendorRawBody(request: Request, maxBytes = 64 * 1024): Promise<string> {
  if (!request.body) throw new HoaWorkflowError("A request body is required.", 400);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new HoaWorkflowError("Request body is too large.", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new HoaWorkflowError("Invalid request body.", 400); }
}
