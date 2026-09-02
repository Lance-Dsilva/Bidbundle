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
  "src/app/app/homeowner/chat/page.tsx",
  "src/app/app/homeowner/bids/page.tsx",
  "src/hooks/useHomeownerRequests.ts",
  "src/hooks/useHomeownerDashboard.ts",
  "src/hooks/useHomeownerInbox.ts",
  "src/hooks/useNeighbourhood.ts",
  "src/components/support/SupportCenter.tsx",
  "src/lib/auth.ts",
] as const;

/**
 * The homeowner endpoints that answered 404 in production. The chat page called
 * all three on mount, and `useNeighbourhoodSummary` re-polled two of them every
 * 15 seconds from the dashboard.
 */
const OBSOLETE_ENDPOINTS = [
  "/api/homeowner/conversations",
  "/api/homeowner/channels",
  "/api/neighbourhood/channel",
  "/api/homeowner/groups",
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Drops block and line comments so prose about old APIs is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` file under `src`, so the sweep cannot miss a new caller. */
function sourceFiles(directory = resolve(ROOT, "src")): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = resolve(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue;
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(full.slice(ROOT.length + 1));
    }
  }
  return found;
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
/** Every literal a template can produce, for the interpolations we can read. */
function expandInterpolations(literal: string): string[] {
  const ternary = /\$\{[^}]*\?\s*["'`]([^"'`]*)["'`]\s*:\s*["'`]([^"'`]*)["'`]\s*\}/;
  const match = ternary.exec(literal);
  if (match) {
    return [match[1]!, match[2]!].flatMap((branch) =>
      expandInterpolations(literal.replace(ternary, branch)),
    );
  }
  return [literal.replace(/\$\{[^}]*\}/g, "x")];
}

function calledPaths(source: string): string[] {
  const body = stripComments(source);
  const paths = new Set<string>();

  /**
   * Reads the literal that opens a call, up to its own closing quote.
   *
   * Interpolations are resolved before the string is cut, so a `${…}` holding
   * quotes does not look like the end of it. A ternary picking between two
   * literal segments — `` `/api/x/${reply ? "a" : "b"}` `` — expands to both
   * real paths rather than to an unresolvable placeholder; anything else
   * collapses to one wildcard segment for a `[param]` route to match.
   */
  const collect = (pattern: RegExp) => {
    for (const match of body.matchAll(pattern)) {
      for (const variant of expandInterpolations(match[2]!)) {
        const path = `/api${variant.split(/["'`?]/)[0]!}`.replace(/\/$/, "");
        if (path !== "/api") paths.add(path);
      }
    }
  };

  collect(/fetch\(\s*(["'`])\/api(\/[^\n]*)/g);
  collect(/apiFetch(?:<[^>]*>)?\(\s*(["'`])(\/[^\n]*)/g);
  collect(/useConversationInbox\(\s*(")(\/[^"]*)"/g);

  return [...paths];
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

  it.each(OBSOLETE_ENDPOINTS)("nothing in src calls %s", (endpoint) => {
    const offenders = sourceFiles().filter((file) =>
      calledPaths(read(file)).includes(endpoint),
    );
    expect(offenders, `${endpoint} is called by ${offenders.join(", ")}`).toEqual([]);
  });

  it.each(OBSOLETE_ENDPOINTS)("no route was invented to answer %s", (endpoint) => {
    expect(ROUTES).not.toContain(endpoint);
  });

  it("the hooks built on those endpoints are deleted, not kept as shims", () => {
    for (const hook of [
      "src/hooks/useHomeownerChat.ts",
      "src/hooks/useNeighbourhoodSummary.ts",
      "src/hooks/useHomeownerGroups.ts",
    ]) {
      expect(existsSync(resolve(ROOT, hook)), `${hook} still exists`).toBe(false);
    }
  });

  /**
   * The whole client tree, not just the files listed above.
   *
   * Every 404 this repo has shipped came from a call site nobody thought to
   * check. Sweeping `src` means a new one fails the moment it is written, in
   * whatever file it appears.
   */
  it("no file anywhere in src calls an endpoint that has no handler", () => {
    const dead: string[] = [];
    for (const file of sourceFiles()) {
      for (const path of calledPaths(read(file))) {
        if (!ROUTES.some((route) => matches(route, path))) dead.push(`${file} → ${path}`);
      }
    }
    expect(dead).toEqual([]);
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
describe("the homeowner shell and its pages do not fetch the same resource", () => {
  const SHELL = "src/components/layout/HomeownerShell.tsx";

  it("the shell loads no page data at all", () => {
    // `/api/homeowner/dashboard` was fetched here *and* by the dashboard page
    // underneath — two requests for one payload on every homeowner route.
    const shellPaths = calledPaths(read(SHELL));
    expect(shellPaths.filter((path) => path.startsWith("/api/homeowner/"))).toEqual([]);
    expect(read(SHELL)).not.toContain("useHomeownerDashboard");
  });

  it("the unread badge comes from the server layout and means messages", () => {
    const layout = read("src/app/app/homeowner/layout.tsx");
    expect(layout).toContain("countUnreadMessages");
    // The badge used to render the unread *notification* count, which the bell
    // beside it already shows.
    expect(read(SHELL)).not.toContain("unread_messages");
    expect(read(SHELL)).toContain("useHomeownerSession");
  });

  it("the chat page keeps that badge honest as it clears threads", () => {
    expect(read("src/app/app/homeowner/chat/page.tsx")).toContain("setUnreadMessages");
  });
});
