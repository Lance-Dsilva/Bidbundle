import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/vercel-build.sh");
const scratchDirectories: string[] = [];

/**
 * Exercise the actual script with harmless local executable doubles. The child
 * environment is deliberately built from scratch: no credentials, database,
 * inherited VERCEL_ENV or real package manager can reach these checks.
 */
function runBuild(environment?: string, nextExit = 0, npmExit = 0) {
  const cwd = mkdtempSync(join(tmpdir(), "bundleen-build-guard-"));
  scratchDirectories.push(cwd);
  const bin = join(cwd, "bin");
  const localBin = join(cwd, "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(localBin, { recursive: true });
  const log = join(cwd, "commands.log");
  function command(path: string, name: string, status: number) {
    writeFileSync(path, `#!/bin/sh\nprintf '%s' '${name}' >> "$GUARD_TEST_LOG"\nprintf ' <%s>' "$@" >> "$GUARD_TEST_LOG"\nprintf '\\n' >> "$GUARD_TEST_LOG"\nexit ${status}\n`);
    chmodSync(path, 0o755);
  }
  command(join(localBin, "next"), "next", nextExit);
  command(join(bin, "npm"), "npm", npmExit);
  // Either direct or npx-style Prisma execution becomes observable and fails.
  command(join(localBin, "prisma"), "prisma", 93);
  command(join(bin, "prisma"), "prisma", 93);
  command(join(bin, "npx"), "npx", 94);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: `${bin}:/usr/bin:/bin`, GUARD_TEST_LOG: log };
  if (environment !== undefined) env.VERCEL_ENV = environment;
  const result = spawnSync("/bin/bash", [SCRIPT], { cwd, env, encoding: "utf8", timeout: 5_000 });
  const commands = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  expect(result.error).toBeUndefined();
  return { ...result, commands };
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Vercel build environment safety", () => {
  it("wires Vercel to the Bash guard and preserves the existing outbox schedule", () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8"));
    expect(config.buildCommand).toBe("bash scripts/vercel-build.sh");
    expect(config.crons).toEqual([{ path: "/api/jobs/outbox", schedule: "0 13 * * *" }]);
    expect(() => execFileSync("/bin/bash", ["-n", SCRIPT], { stdio: "pipe" })).not.toThrow();
  });

  it.each(["preview", "development"])("%s compiles with the installed Next executable only", (environment) => {
    const result = runBuild(environment);
    expect(result.status).toBe(0);
    expect(result.commands).toEqual(["next <build>"]);
  });

  it("production delegates to the unchanged migration-bearing package build", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe("prisma migrate deploy && next build");
    const result = runBuild("production");
    expect(result.status).toBe(0);
    expect(result.commands).toEqual(["npm <run> <build>"]);
  });

  it.each([undefined, "", "staging", "Preview", "preview ", "production\npreview"])("refuses absent or unrecognized environment %j before running any command", (environment) => {
    const result = runBuild(environment);
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
    expect(result.stderr).toMatch(/VERCEL_ENV/);
  });

  it.each(["preview", "development"])("propagates the %s Next compilation exit code without falling back to migrations", (environment) => {
    const result = runBuild(environment, 37);
    expect(result.status).toBe(37);
    expect(result.commands).toEqual(["next <build>"]);
  });

  it("propagates production package build failure without retrying another command", () => {
    const result = runBuild("production", 0, 41);
    expect(result.status).toBe(41);
    expect(result.commands).toEqual(["npm <run> <build>"]);
  });
});
