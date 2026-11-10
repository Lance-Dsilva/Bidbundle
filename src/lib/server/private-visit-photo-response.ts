import "server-only";

import { hoaErrorResponse } from "@/lib/server/hoa-api";

/** Apply the photo privacy boundary to successes, denials and failures alike. */
export function privateVisitPhotoResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  const vary = (response.headers.get("Vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const value of ["Cookie", "Authorization"]) {
    if (!vary.some((existing) => existing.toLowerCase() === value.toLowerCase())) vary.push(value);
  }
  response.headers.set("Vary", vary.join(", "));
  return response;
}

/** Keep even early authentication/validation returns inside the same boundary. */
export function privateVisitPhotoHandler<Context>(
  scope: string,
  handler: (request: Request, context: Context) => Promise<Response>,
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    try {
      return privateVisitPhotoResponse(await handler(request, context));
    } catch (error) {
      return privateVisitPhotoResponse(hoaErrorResponse(scope, error));
    }
  };
}
