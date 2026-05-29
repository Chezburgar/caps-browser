/* Capitals Browser service worker — offline app shell + installability */
const CACHE = "caps-browser-v4";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "assets/logo.svg",
  "assets/icon.svg",
  "assets/icon-maskable.svg",
  "assets/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never cache the live music listing — it must reflect the folder right now.
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // App navigations: serve cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Let cross-origin calls (Google, Open-Meteo, audio you host elsewhere) pass straight through.
  if (!sameOrigin) return;

  // Same-origin assets: cache-first, then fill the cache.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
