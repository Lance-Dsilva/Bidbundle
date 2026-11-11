/* Bundleen service worker — app-shell cache with network-first pages */
const CACHE = "bundleen-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];

function isPrivateUrl(url) {
  return /^\/(?:bid|vendor-unsubscribe|auth|get-started|sign-in|app|admin)(?:\/|$)/.test(url.pathname)
    || url.searchParams.has("returnTo");
}

function canCache(response) {
  return response.ok && !response.redirected
    && !/(?:^|,)\s*(?:private|no-store)(?:\s|=|,|$)/i.test(response.headers.get("Cache-Control") || "");
}

async function remember(request, response) {
  // Cache API does not honor HTTP no-store/private directives on its own.
  const cache = await caches.open(CACHE);
  if (canCache(response)) await cache.put(request, response.clone());
  else await cache.delete(request);
}

async function recalled(request) {
  const cache = await caches.open(CACHE);
  const response = await cache.match(request);
  if (!response || canCache(response)) return response;
  await cache.delete(request);
  return undefined;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bundleen-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never persist token URLs or authenticated pages, even when a token ends
  // in an image extension. Keep auth returnTo handoffs out of Cache API too.
  if (isPrivateUrl(url) || request.cache === "no-store") return;
  // Never cache API calls or Next.js HMR/dev endpoints
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Pages: network first, fall back to cache, then offline shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          await remember(request, response).catch(() => undefined);
          return response;
        })
        .catch(() =>
          recalled(request).then((cached) => cached || recalled(OFFLINE_URL))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons") ||
    /\.(png|jpg|jpeg|svg|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      recalled(request).then((cached) => {
        const network = fetch(request)
          .then(async (response) => {
            await remember(request, response).catch(() => undefined);
            return response;
          })
          .catch(() => cached);
        event.waitUntil(network.then(() => undefined));
        return cached || network;
      })
    );
  }
});
