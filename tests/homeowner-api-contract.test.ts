import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every `/api/...` path the homeowner client calls must resolve to a real Route
 * Handler.
 *
 * This is the test the missing endpoints would not have survived: the new
 * request page called `POST /api/requests` and the shell called
 * `GET /api/homeowner/dashboard`, and neither route file existed, so production
 * answered with Next's HTML 404 page and the UI printed `HTTP 404`. Reading the
 * call sites out of the source and resolving each one against the route tree
 * catches that class of break the moment it is introduced, for any file, not
 * just the two that were already broken.
 */

const ROOT = resolve(import.meta.dirname, "..");
const API_ROOT = resolve(ROOT, "src/app/api");

/** Files whose `/api` calls this contract covers. */
const CLIENT_SOURCES = [
  "src/app/app/homeowner/request/page.tsx",
  "src/app/app/homeowner/dashboard/page.tsx",
  "src/hooks/useHomeownerRequests.ts",
  "src/hooks/useHomeownerDashboard.ts",
  "src/components/support/SupportCenter.tsx",
  "src/lib/auth.ts",
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Drops block and line comments so prose about old APIs is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `route.ts` in the tree, as a URL path with its dynamic segments. */
function routePaths(directory = API_ROOT, prefix = "/api"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = resolve(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routePaths(full, `${prefix}/${entry}`));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      found.push(prefix);
    }
  }
  return found;
}

const ROUTES = routePaths();

/** True when `path` is served by `route`, allowing for `[param]` segments. */
function matches(route: string, path: string): boolean {
  const routeParts = route.split("/");
  const pathParts = path.split("/");
  if (routeParts.length !== pathParts.length) return false;
  return routeParts.every(
    (part, index) => part.startsWith("[") || part === pathParts[index],
  );
}

/**
 * The `/api` paths a source file requests.
 *
 * Covers both conventions in the codebase: a bare `fetch("/api/...")` and
 * `apiFetch("/...")`, which prefixes `/api` itself. Template placeholders
 * collapse to a single segment so a dynamic route can match them.
 */
function calledPaths(source: string): string[] {
  const paths = new Set<string>();

  for (const match of source.matchAll(/fetch\(\s*[`"']\/api(\/[^`"'?)]*)/g)) {
    paths.add(`/api${match[1]!}`);
  }
  for (const match of source.matchAll(/apiFetch<[^>]*>\(\s*[`"'](\/[^`"'?)]*)/g)) {
    paths.add(`/api${match[1]!}`);
  }
  for (const match of source.matchAll(/apiFetch\(\s*[`"'](\/[^`"'?)]*)/g)) {
    paths.add(`/api${match[1]!}`);
  }

  return [...paths]
    .map((path) => path.replace(/\$\{[^}]*\}/g, "x").replace(/\/$/, ""))
    .filter((path) => path !== "/api");
}

describe("homeowner and support API contract", () => {
  it("finds the route tree", () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES).toContain("/api/homeowner/requests");
    expect(ROUTES).toContain("/api/homeowner/dashboard");
  });

  it("reads a non-empty set of call sites", () => {
    const all = CLIENT_SOURCES.flatMap((path) => calledPaths(read(path)));
    expect(all.length).toBeGreaterThan(0);
    expect(all).toContain("/api/homeowner/requests");
    expect(all).toContain("/api/homeowner/dashboard");
  });

  it.each(CLIENT_SOURCES)("every endpoint %s calls exists", (relativePath) => {
    const called = calledPaths(read(relativePath));

    for (const path of called) {
      expect(
        ROUTES.some((route) => matches(route, path)),
        `${relativePath} calls ${path}, which has no route handler`,
      ).toBe(true);
    }
  });

  it("no longer calls the endpoints that returned 404 in production", () => {
    for (const relativePath of CLIENT_SOURCES) {
      const source = read(relativePath);
      expect(source).not.toMatch(/["'`]\/requests["'`]/);
      expect(source).not.toMatch(/apiFetch[^\n]*["'`]\/homeowner\/conversations/);
    }
    // And the routes those calls would have needed were not invented to
    // silence them.
    expect(existsSync(resolve(API_ROOT, "requests/route.ts"))).toBe(false);
  });

  it("uses the session cookie rather than a bearer token", () => {
    for (const relativePath of [
      "src/app/app/homeowner/request/page.tsx",
      "src/hooks/useHomeownerRequests.ts",
      "src/hooks/useHomeownerDashboard.ts",
    ]) {
      // Comments are stripped first: these files explain *why* the old token
      // plumbing is gone, and that prose must not read as a call site.
      const source = stripComments(read(relativePath));
      expect(source).not.toMatch(/getToken\(/);
      expect(source).not.toMatch(/Authorization/);
    }
  });

  it("never renders a raw HTTP status as the customer-facing error", () => {
    const source = read("src/app/app/homeowner/request/page.tsx");
    // The page may mention a status inside a sentence, but the bare
    // `HTTP ${status}` string that `apiFetch` produces must never be the
    // message a customer sees.
    expect(source).not.toMatch(/setFormError\((?:err|error)\b/);
    expect(source).toMatch(/payload\?\.error/);
  });
});
