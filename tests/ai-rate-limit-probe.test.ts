import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type Call = { url: string; authorization: string; parts: Array<string | number>; hasTimeout: boolean };
function probe(scenario = "success", overrides: Record<string, string | undefined> = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "bundleen-ai-probe-test-"));
  const transcript = join(temporary, "calls.json"), preload = join(temporary, "preload.mjs");
  writeFileSync(preload, `import { writeFileSync } from 'node:fs';
const calls = [];
process.on('exit', () => writeFileSync(process.env.PROBE_TEST_TRANSCRIPT, JSON.stringify(calls), {mode:0o600}));
globalThis.fetch = async (url, options) => {
  const parts = JSON.parse(options.body); calls.push({url:String(url),authorization:options.headers.Authorization,parts,hasTimeout:!!options.signal});
  const scenario = process.env.PROBE_TEST_SCENARIO;
  if (parts[0] === 'PING') {
    if (scenario === 'ping-fails') return Response.json({error:'synthetic-service-error'}, {status:503});
    if (scenario === 'ping-not-pong') return Response.json({result:'NOT_PONG'});
    return Response.json({result:'PONG'});
  }
  if (parts[0] === 'EVAL') {
    if (scenario === 'eval-response-lost') throw new Error('synthetic-token-never-log https://synthetic-endpoint.invalid '+parts[3]);
    if (scenario === 'eval-wrong-result') return Response.json({result:2});
    return Response.json({result:1});
  }
  if (parts[0] === 'DEL') return scenario === 'cleanup-fails' ? Response.json({error:'synthetic-cleanup-error'}, {status:503}) : Response.json({result:1});
  throw new Error('Forbidden command in diagnostic');
};\n`);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), NODE_ENV: "production", VERIFY_AI_RATE_LIMIT: "1", VERCEL_ENV: "preview",
    RATE_LIMIT_KV_REST_API_URL: "https://dedicated.example.invalid", RATE_LIMIT_KV_REST_API_TOKEN: "synthetic-dedicated-token",
    UPSTASH_REDIS_REST_URL: "https://upstash.example.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
    KV_REST_API_URL: "https://legacy.example.invalid", KV_REST_API_TOKEN: "synthetic-legacy-token",
    PROBE_TEST_TRANSCRIPT: transcript, PROBE_TEST_SCENARIO: scenario,
  };
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete env[key]; else env[key] = value; }
  try {
    // The real standalone script and shared TS resolver execute in Node. Only
    // fetch transport is replaced; no Redis or other network request can run.
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", preload, resolve(import.meta.dirname, "../scripts/verify-ai-rate-limit.mjs")], {
      cwd: resolve(import.meta.dirname, ".."), env, encoding: "utf8", timeout: 10000, maxBuffer: 128 * 1024,
    });
    const calls = JSON.parse(readFileSync(transcript, "utf8")) as Call[];
    return { status: result.status, logs: result.stdout + result.stderr, calls };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function expectSanitized(result: ReturnType<typeof probe>) {
  for (const text of ["https://dedicated.example.invalid", "synthetic-dedicated-token", "synthetic-token-never-log", "https://synthetic-endpoint.invalid"]) expect(result.logs).not.toContain(text);
  for (const call of result.calls) for (const part of call.parts) if (typeof part === "string" && part.startsWith("bundleen:diagnostic:")) expect(result.logs).not.toContain(part);
}

describe("opt-in Preview-only AI rate-limit probe", () => {
  it.each([
    { VERIFY_AI_RATE_LIMIT: undefined }, { VERIFY_AI_RATE_LIMIT: "true" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: undefined },
  ])("refuses unapproved execution without sending any command: %j", env => {
    const result = probe("success", env); expect(result.status).not.toBe(0); expect(result.calls).toHaveLength(0); expectSanitized(result);
  });
  it("fails without a complete resource pair before opening transport", () => {
    const result = probe("success", { RATE_LIMIT_KV_REST_API_TOKEN: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_TOKEN: "" });
    expect(result.status).toBe(1); expect(result.calls).toHaveLength(0); expect(result.logs).toContain('"source":"unconfigured"'); expectSanitized(result);
  });
  it.each(["not-a-valid-url-synthetic", "http://dedicated.example.invalid", "https://user:password@dedicated.example.invalid", "https://dedicated.example.invalid?token=synthetic"])("refuses unsafe endpoint configuration without echoing it: %s", endpoint => {
    const result = probe("success", { RATE_LIMIT_KV_REST_API_URL: endpoint });
    expect(result.status).toBe(1); expect(result.calls).toHaveLength(0); expect(result.logs).not.toContain(endpoint); expectSanitized(result);
  });
  it.each(["ping-fails", "ping-not-pong"])("never attempts a write when connection check fails: %s", scenario => {
    const result = probe(scenario); expect(result.status).toBe(1); expect(result.calls.map(call => call.parts[0])).toEqual(["PING"]); expectSanitized(result);
  });
  it("uses the shared dedicated pair and only one owned expiring UUID key", () => {
    const result = probe(); expect(result.status).toBe(0); expect(result.calls.map(call => call.parts[0])).toEqual(["PING", "EVAL", "DEL"]);
    for (const call of result.calls) { expect(call.url).toBe("https://dedicated.example.invalid/"); expect(call.authorization).toBe("Bearer synthetic-dedicated-token"); expect(call.hasTimeout).toBe(true); }
    const evalCall = result.calls[1].parts, key = String(evalCall[3]), script = String(evalCall[1]);
    expect(evalCall[2]).toBe(1); expect(evalCall).toHaveLength(4); expect(key).toMatch(/^bundleen:diagnostic:ai:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(script).toContain("redis.call('SET',KEYS[1],'0','EX',30)"); expect(script).toContain("redis.call('INCR',KEYS[1])"); expect(script).toContain("redis.call('DEL',KEYS[1])");
    expect(script.match(/redis\.call/g)).toHaveLength(3); expect(script).not.toMatch(/SCAN|FLUSH|KEYS\[[2-9]|ARGV/i);
    expect(result.calls[2].parts).toEqual(["DEL", key]); expect(result.logs).toContain('"source":"dedicated"'); expect(result.logs).toContain('"syntheticRateLimitKeyCleanup":"completed"'); expectSanitized(result);
  });
  it("cleans exactly the same key after a lost EVAL response and retains failure status", () => {
    const result = probe("eval-response-lost"); expect(result.status).toBe(1); expect(result.calls.map(call => call.parts[0])).toEqual(["PING", "EVAL", "DEL"]);
    expect(result.calls[2].parts).toEqual(["DEL", result.calls[1].parts[3]]); expect(result.logs).toContain('"syntheticRateLimitKeyCleanup":"completed"'); expectSanitized(result);
    const failure = result.logs.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)).find(row => row.aiRateLimitConnection === "failed");
    expect(failure).toMatchObject({ phase: "scripting", httpStatus: null });
  });
  it("also cleans after a nonconforming scripting result", () => {
    const result = probe("eval-wrong-result"); expect(result.status).toBe(1); expect(result.calls[2].parts).toEqual(["DEL", result.calls[1].parts[3]]); expectSanitized(result);
  });
  it("fails the process when cleanup cannot be confirmed and reports only the maximum TTL", () => {
    const result = probe("cleanup-fails"); expect(result.status).toBe(1); expect(result.calls.map(call => call.parts[0])).toEqual(["PING", "EVAL", "DEL"]);
    expect(result.logs).toContain('"syntheticRateLimitKeyCleanup":"failed"'); expect(result.logs).toContain('"maximumTtlSeconds":30'); expectSanitized(result);
  });
});
