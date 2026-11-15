import { randomUUID } from "node:crypto";
import { getRateLimitRedisCredentials } from "../src/lib/server/rate-limit-config.ts";

if (process.env.VERIFY_AI_RATE_LIMIT !== "1" || process.env.VERCEL_ENV !== "preview") {
  throw new Error("Explicit Preview rate-limit verification opt-in required.");
}
let credentials = null;
let endpoint = null;
const key = `bundleen:diagnostic:ai:${randomUUID()}`;
let attempted = false;
let phase = "configuration";
let httpStatus = null;
async function command(parts) {
  httpStatus = null;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify(parts), signal: AbortSignal.timeout(10000) });
  httpStatus = response.status;
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.error || !value || !("result" in value)) throw new Error("Rate-limit diagnostic command failed.");
  return value.result;
}
try {
  credentials = getRateLimitRedisCredentials();
  if (!credentials) throw new Error("Rate-limit connection is not configured.");
  endpoint = new URL(credentials.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Invalid rate-limit endpoint.");
  phase = "ping";
  if (await command(["PING"]) !== "PONG") throw new Error("Rate-limit connection did not respond.");
  attempted = true;
  phase = "scripting";
  // One owned UUID key only. The server script deletes it atomically, with a
  // short TTL and an exact-key cleanup for indeterminate transport responses.
  const result = await command(["EVAL", "redis.call('SET',KEYS[1],'0','EX',30); local n=redis.call('INCR',KEYS[1]); redis.call('DEL',KEYS[1]); return n", 1, key]);
  if (result !== 1) throw new Error("Rate-limit scripting/write verification failed.");
  console.log(JSON.stringify({ aiRateLimitConnection: "passed", source: credentials.source, pong: true, scriptingAndWrite: true, customerKeysTouched: false, modelCalled: false }));
} catch (error) {
  console.error(JSON.stringify({ aiRateLimitConnection: "failed", source: credentials?.source ?? "unconfigured", phase, httpStatus, errorName: error instanceof Error && ["Error", "TypeError", "AbortError", "TimeoutError"].includes(error.name) ? error.name : "Error" })); process.exitCode = 1;
} finally {
  if (attempted) {
    try { phase = "cleanup"; await command(["DEL", key]); console.log(JSON.stringify({ syntheticRateLimitKeyCleanup: "completed" })); }
    catch { console.error(JSON.stringify({ syntheticRateLimitKeyCleanup: "failed", maximumTtlSeconds: 30 })); process.exitCode = 1; }
  }
}
