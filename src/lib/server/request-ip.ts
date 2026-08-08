import "server-only";

/**
 * Client IP extraction for rate-limit identifiers.
 *
 * Only headers Vercel itself sets on the edge are trusted. `x-forwarded-for`
 * is attacker-controlled on a direct origin hit, so it is read *last* and only
 * its first entry is used — Vercel appends the real client IP as the leftmost
 * value, and anything a client injected ends up to the right of it.
 *
 * `x-real-ip` and `x-vercel-forwarded-for` are overwritten by the platform on
 * every request, which makes them the more reliable of the three.
 */

/** Marker used when no IP can be determined (local `next dev`, unit tests). */
export const UNKNOWN_IP = "unknown";

function firstForwardedAddress(value: string): string | null {
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Strips the port from `1.2.3.4:5678` while leaving bare IPv6 addresses —
 * which are full of colons — untouched.
 */
function stripPort(address: string): string {
  if (address.startsWith("[")) {
    const closing = address.indexOf("]");
    return closing === -1 ? address : address.slice(1, closing);
  }

  const parts = address.split(":");
  return parts.length === 2 ? parts[0] : address;
}

export function getRequestIp(request: Request): string {
  const headers = request.headers;

  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const address = firstForwardedAddress(candidate);
    if (address) return stripPort(address);
  }

  return UNKNOWN_IP;
}

/**
 * True when the platform gave us no usable IP. Callers use this to decide
 * whether an IP-scoped limit is meaningful: on localhost every request would
 * otherwise share the single `unknown` bucket and lock the developer out after
 * five attempts.
 */
export function isUnknownIp(ip: string): boolean {
  return ip === UNKNOWN_IP;
}
