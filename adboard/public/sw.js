// Service worker. Deliberately conservative: the network always wins when it is
// available, so a deploy is never masked by a stale cache. The cache exists to
// keep the app usable offline, not to serve old code.
//
// Bump CACHE_VERSION to retire old caches.
const CACHE_VERSION = "bmb-v1";
const SHELL = [
  "/",
  "/listings.html",
  "/offline.html",
  "/styles.css",
  "/shared.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // Individual failures must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch the API or the OAuth round trip: those must always be live.
  if (url.origin === self.location.origin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")))
    return;

  // Never touch video: <video> fetches with Range requests, which the Cache
  // API can't satisfy (a cached full-body 200 breaks seeking, notably in
  // Safari), and multi-MB files don't belong in the offline shell anyway.
  if (url.pathname.startsWith("/videos/") || request.headers.has("range")) return;

  // Cross-origin (photography, fonts): let the network handle it.
  if (url.origin !== self.location.origin) return;

  // Page loads: network first, fall back to cache, then the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("/offline.html")))
    );
    return;
  }

  // Static assets: network first as well.
  //
  // Deliberately NOT stale-while-revalidate. These filenames are not
  // content-hashed, so serving a cached styles.css / shared.js alongside freshly
  // fetched HTML can pair new markup with old CSS and visibly break the page
  // after a deploy. The cache is here for offline use only — the network wins
  // whenever it is reachable.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
