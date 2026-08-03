const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders as Record<string, string> ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...rest, headers });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      message = formatApiDetail((err as { detail?: unknown }).detail) ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
