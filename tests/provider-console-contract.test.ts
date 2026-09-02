import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The provider console's client/server contract, read out of the source.
 *
 * The console shipped four endpoints that no Route Handler ever served —
 * `/api/provider/dashboard`, `/api/provider/me`, `/api/provider/conversations`,
 * and `/api/provider/reviews` — and the shell called two of them on *every*
 * provider route while the pages underneath called them again. The result was a
 * wall of 404s and duplicate requests on every navigation.
 *
 * Three properties keep that from coming back, and all three are checkable
 * statically:
 *
 * 1. None of the four paths is requested anywhere, and no route was invented to
 *    make them return something.
 * 2. Every `/api` path the console calls resolves to a real handler.
 * 3. The shell and the pages do not fetch the same resource.
 */

const ROOT = resolve(import.meta.dirname, "..");
const API_ROOT = resolve(ROOT, "src/app/api");
const SRC_ROOT = resolve(ROOT, "src");

/** The endpoints that returned 404 in production. Never reintroduce these. */
const OBSOLETE_ENDPOINTS = [
  "/api/provider/dashboard",
  "/api/provider/me",
  "/api/provider/conversations",
  "/api/provider/reviews",
] as const;

const PROVIDER_SHELL = "src/components/layout/ProviderShell.tsx";

const PROVIDER_PAGES = [
  "src/app/app/provider/dashboard/page.tsx",
  "src/app/app/provider/profile/page.tsx",
  "src/app/app/provider/reviews/page.tsx",
  "src/app/app/provider/messages/page.tsx",
  "src/app/app/provider/bids/page.tsx",
  "src/app/app/provider/schedule/page.tsx",
  "src/app/app/provider/earnings/page.tsx",
  "src/app/app/provider/job-feed/page.tsx",
  "src/app/app/provider/hoa/page.tsx",
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Drops block and line comments so prose about old APIs is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` file under `src`, so the sweep cannot miss a new caller. */
function sourceFiles(directory = SRC_ROOT): string[] {
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
const SOURCES = sourceFiles();

/** True when `path` is served by `route`, allowing for `[param]` segments. */
function matches(route: string, path: string): boolean {
  const routeParts = route.split("/");
  const pathParts = path.split("/");
  if (routeParts.length !== pathParts.length) return false;
  return routeParts.every((part, index) => part.startsWith("[") || part === pathParts[index]);
}

/**
 * The `/api` paths a source file requests.
 *
 * Covers both conventions in the codebase: a bare `fetch("/api/...")` and
 * `apiFetch("/...")`, which prefixes `/api` itself. Template placeholders
 * collapse to a single segment so a dynamic route can match them.
 */
function calledRequests(source: string): Array<{ method: string; path: string }> {
  const body = stripComments(source);
  const found: Array<{ method: string; path: string }> = [];

  const collect = (pattern: RegExp) => {
    for (const match of body.matchAll(pattern)) {
      const path = `/api${match[1]!}`
        .replace(/\$\{[^}]*\}/g, "x")
        .replace(/\/$/, "");
      if (path === "/api") continue;
      // The verb lives in the options object just after the path, if at all.
      const method =
        /method:\s*"([A-Z]+)"/.exec(body.slice(match.index ?? 0, (match.index ?? 0) + 400))?.[1] ??
        "GET";
      found.push({ method, path });
    }
  };

  collect(/fetch\(\s*[`"']\/api(\/[^`"'?)]*)/g);
  collect(/apiFetch(?:<[^>]*>)?\(\s*[`"'](\/[^`"'?)]*)/g);
  // The shared inbox hook builds its paths from a base the caller passes, so
  // the literal lives at the call site rather than at the `apiFetch`.
  collect(/useConversationInbox\(\s*"(\/[^"]*)"/g);

  return found;
}

/** Just the distinct paths, for the "does this route exist?" checks. */
function calledPaths(source: string): string[] {
  return [...new Set(calledRequests(source).map((request) => request.path))];
}

/**
 * The local modules a file imports that can themselves make requests.
 *
 * Components are followed as well as hooks and helpers, because several
 * provider pages are thin wrappers around one panel that owns the fetching.
 * Server modules are skipped: they cannot run in a browser.
 */
function requestingImports(source: string): string[] {
  return [...source.matchAll(/from\s+"@\/((?:hooks|lib|components)\/[A-Za-z0-9_/-]+)"/g)]
    .map((match) => match[1]!)
    .filter((module) => !module.startsWith("lib/server/"))
    .flatMap((module) => [`src/${module}.ts`, `src/${module}.tsx`])
    .filter((candidate) => existsSync(resolve(ROOT, candidate)));
}

/**
 * Every raw `/api` call site a component causes, directly or through the hooks
 * and client helpers it pulls in. Duplicates are kept: a resource requested
 * twice on one page is exactly what the ownership tests look for.
 */
function rawRequests(relativePath: string, seen = new Set<string>()): string[] {
  if (seen.has(relativePath)) return [];
  seen.add(relativePath);

  const source = read(relativePath);
  return [
    // A `PUT` and a `DELETE` on the same path are two operations, not a
    // duplicate read, so the verb is part of the identity here.
    ...new Set(calledRequests(source).map((request) => `${request.method} ${request.path}`)),
    ...requestingImports(source).flatMap((module) => rawRequests(module, seen)),
  ];
}

/** The distinct paths a component causes, transitively. */
function effectivePaths(relativePath: string): string[] {
  return [...new Set(rawRequests(relativePath).map((request) => request.split(" ")[1]!))];
}

describe("obsolete provider endpoints stay gone", () => {
  it("finds the route tree and the source tree", () => {
    expect(ROUTES).toContain("/api/provider/marketplace");
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it.each(OBSOLETE_ENDPOINTS)("nothing in src calls %s", (endpoint) => {
    const offenders = SOURCES.filter((file) => calledPaths(read(file)).includes(endpoint));
    expect(offenders, `${endpoint} is called by ${offenders.join(", ")}`).toEqual([]);
  });

  it.each(OBSOLETE_ENDPOINTS)("no route handler was invented to answer %s", (endpoint) => {
    // A compatibility route returning fabricated data would silence the 404
    // without fixing anything, so its absence is part of the contract.
    expect(ROUTES).not.toContain(endpoint);
  });

  it("the hooks built on those endpoints are deleted, not kept as shims", () => {
    for (const hook of [
      "src/hooks/useProviderDashboard.ts",
      "src/hooks/useProviderMessages.ts",
      "src/hooks/useProviderReviews.ts",
    ]) {
      expect(existsSync(resolve(ROOT, hook)), `${hook} still exists`).toBe(false);
    }
  });

  it("no provider client code carries the old snake_case contract", () => {
    for (const file of [PROVIDER_SHELL, ...PROVIDER_PAGES]) {
      const source = stripComments(read(file));
      for (const field of [
        "unread_messages",
        "win_rate_pct",
        "revenue_30d_cents",
        "other_user_id",
        "homeowner_name",
      ]) {
        expect(source, `${file} still reads ${field}`).not.toContain(field);
      }
    }
  });
});

describe("every endpoint the provider console calls exists", () => {
  it.each([PROVIDER_SHELL, ...PROVIDER_PAGES])("%s", (relativePath) => {
    for (const path of effectivePaths(relativePath)) {
      expect(
        ROUTES.some((route) => matches(route, path)),
        `${relativePath} calls ${path}, which has no route handler`,
      ).toBe(true);
    }
  });

  it("reads a non-empty set of call sites", () => {
    expect(effectivePaths("src/app/app/provider/dashboard/page.tsx")).toContain(
      "/api/provider/overview",
    );
    expect(effectivePaths("src/app/app/provider/messages/page.tsx")).toContain(
      "/api/provider/inbox",
    );
    expect(effectivePaths("src/app/app/provider/reviews/page.tsx")).toContain(
      "/api/provider/ratings",
    );
  });
});

describe("the shell and the pages do not fetch the same resource", () => {
  const shellPaths = effectivePaths(PROVIDER_SHELL);

  it("the shell loads no provider page data at all", () => {
    // Identity and notifications are cross-role chrome and legitimately live
    // here. Anything under `/api/provider/` is page data by definition.
    expect(shellPaths.filter((path) => path.startsWith("/api/provider/"))).toEqual([]);
  });

  it("the shell takes its own provider facts from the server layout", () => {
    const layout = read("src/app/app/provider/layout.tsx");
    expect(layout).toContain("getProviderShellIdentity");
    expect(read(PROVIDER_SHELL)).toContain("useProviderSession");
  });

  it.each(PROVIDER_PAGES)("%s shares no fetched resource with the shell", (page) => {
    const overlap = effectivePaths(page).filter((path) => shellPaths.includes(path));
    expect(overlap, `${page} refetches ${overlap.join(", ")}`).toEqual([]);
  });

  it.each(PROVIDER_PAGES)("%s requests each of its own resources once", (page) => {
    // `effectivePaths` de-duplicates, so this compares it against the raw list
    // of call sites: a page mounting two hooks that hit the same endpoint shows
    // up as a longer raw list than distinct list.
    const raw = rawRequests(page);
    expect(new Set(raw).size).toBe(raw.length);
  });
});

describe("the working provider surfaces still use their canonical endpoints", () => {
  // Removing the four dead endpoints must not take the working ones with it.
  // Each row is a page and the endpoint it has to keep reaching.
  const CANONICAL: Array<[string, string]> = [
    ["src/app/app/provider/job-feed/page.tsx", "/api/provider/marketplace"],
    ["src/app/app/provider/bids/page.tsx", "/api/provider/marketplace"],
    ["src/app/app/provider/schedule/page.tsx", "/api/provider/marketplace"],
    ["src/app/app/provider/earnings/page.tsx", "/api/provider/marketplace/earnings"],
    ["src/app/app/provider/profile/page.tsx", "/api/profile"],
    ["src/app/app/provider/profile/page.tsx", "/api/profile/provider"],
    ["src/components/provider/ProviderServiceAreasPanel.tsx", "/api/provider/service-areas"],
  ];

  it.each(CANONICAL)("%s still calls %s", (page, endpoint) => {
    expect(effectivePaths(page)).toContain(endpoint);
  });

  it("the profile page reads identity from the profile endpoints, not an aggregate", () => {
    const paths = effectivePaths("src/app/app/provider/profile/page.tsx");
    expect(paths).toContain("/api/profile");
    expect(paths).toContain("/api/profile/provider");
    expect(paths).not.toContain("/api/provider/me");
  });
});

describe("the shared inbox contract", () => {
  // Both consoles drive `useConversationInbox` with a base path, so the four
  // routes under each base are what actually has to exist. Static extraction
  // cannot see through the template literals inside the hook, so the contract
  // is stated here instead of inferred.
  const INBOX_BASES = ["/api/provider/inbox", "/api/homeowner/inbox"] as const;

  it.each(INBOX_BASES)("%s serves list, thread, messages, and read", (base) => {
    for (const path of [base, `${base}/x`, `${base}/x/messages`, `${base}/x/read`]) {
      expect(
        ROUTES.some((route) => matches(route, path)),
        `${path} has no route handler`,
      ).toBe(true);
    }
  });

  it("the two wrappers pass exactly those bases and add no fetching of their own", () => {
    expect(read("src/hooks/useProviderInbox.ts")).toContain('useConversationInbox("/provider/inbox")');
    expect(read("src/hooks/useHomeownerInbox.ts")).toContain('useConversationInbox("/homeowner/inbox")');
  });
});

describe("provider console fetching behaviour", () => {
  // `useConversationInbox` is the shared implementation behind both the
  // provider and the customer inbox, so it is the file that has to hold these
  // properties.
  const HOOKS = [
    "src/hooks/useProviderOverview.ts",
    "src/hooks/useProviderRatings.ts",
    "src/hooks/useConversationInbox.ts",
  ] as const;

  it.each(HOOKS)("%s aborts in flight requests instead of writing after unmount", (hook) => {
    const source = read(hook);
    expect(source).toContain("AbortController");
    expect(source).toMatch(/signal\.aborted/);
    // A cleanup function that aborts is what stops a late response from
    // setting state on an unmounted page.
    expect(source).toMatch(/return \(\)\s*=>[\s\S]{0,60}abort\(\)/);
  });

  it.each(HOOKS)("%s does not retry a failure on its own", (hook) => {
    const source = stripComments(read(hook));
    // No timers and no self-scheduling: a failing endpoint produces one error,
    // not a request loop. Refreshing is the reader's choice.
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  it.each(HOOKS)("%s carries no bearer token or client-supplied owner", (hook) => {
    const source = stripComments(read(hook));
    expect(source).not.toMatch(/getToken\(/);
    expect(source).not.toMatch(/Authorization/);
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/provider_id|providerId=|user_id=/);
  });
});
