import "server-only";

export type RateLimitRedisCredentials = { url: string; token: string; source: "dedicated" | "upstash" | "legacy" };

/** Resolve only complete pairs; never combine credentials from separate stores. */
export function getRateLimitRedisCredentials(): RateLimitRedisCredentials | null {
  const pairs = [
    ["dedicated", process.env.RATE_LIMIT_KV_REST_API_URL, process.env.RATE_LIMIT_KV_REST_API_TOKEN],
    ["upstash", process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    ["legacy", process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN],
  ] as const;
  for (const [source, configuredUrl, configuredToken] of pairs) {
    const url = configuredUrl?.trim(), token = configuredToken?.trim();
    if (url && token) return { url, token, source };
  }
  return null;
}
