/**
 * Same-origin API client.
 *
 * Requests go to this application's own `/api/...` Route Handlers. There is no
 * configurable base URL and no `Authorization` header: the Clerk session
 * cookie is HttpOnly and is attached by the browser automatically, which is
 * why the old `NEXT_PUBLIC_API_URL` + localStorage bearer token pair is gone.
 */
const BASE_PATH = "/api";

function formatApiDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as { msg?: unknown; loc?: unknown };
          const msg = typeof record.msg === "string" ? record.msg : null;
          const loc = Array.isArray(record.loc) ? record.loc.filter((part) => typeof part === "string" || typeof part === "number").join(".") : null;
          if (msg && loc) return `${loc}: ${msg}`;
          if (msg) return msg;
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));

    return parts.length > 0 ? parts.join("; ") : null;
  }

  if (detail && typeof detail === "object") {
    const record = detail as { message?: unknown; error?: unknown; detail?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (typeof record.detail === "string") return record.detail;
  }

  return null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Per-field messages from a `400`, for inline form errors. */
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Reads whichever error shape the responding handler used.
 *
 * The profile routes answer `{ error, fields }`; the older handlers answer
 * `{ detail }`. Both are read here so no call site has to care.
 */
function readErrorBody(body: unknown): { message: string | null; fields?: Record<string, string> } {
  if (!body || typeof body !== "object") return { message: null };

  const record = body as { error?: unknown; detail?: unknown; fields?: unknown };
  const fields =
    record.fields && typeof record.fields === "object"
      ? (record.fields as Record<string, string>)
      : undefined;

  if (typeof record.error === "string") return { message: record.error, fields };
  return { message: formatApiDetail(record.detail), fields };
}

export type ApiFetchOptions = RequestInit & {
  /**
   * @deprecated Accepted and ignored. Legacy call sites still pass a token;
   * it is never read and never sent. Authentication is the HttpOnly session
   * cookie. Drop this argument as each screen is migrated.
   */
  token?: string;
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token: _ignoredToken, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((extraHeaders as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${BASE_PATH}${path}`, {
    ...rest,
    headers,
    // Same-origin is the fetch default, but stating it makes the intent
    // explicit: the session cookie travels with the request, nothing else.
    credentials: "same-origin",
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let fields: Record<string, string> | undefined;
    try {
      const parsed = readErrorBody(await res.json());
      message = parsed.message ?? message;
      fields = parsed.fields;
    } catch {}
    throw new ApiError(res.status, message, fields);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
