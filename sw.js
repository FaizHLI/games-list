// Bump this to force clients onto a fresh cache.
const CACHE = "games-list-447151eb2f";

const SHELL = [
  "./",
  "./index.html",
  "./playlist.html",
  "./manifest.webmanifest",
  "./assets/fonts.css?v=8ebdff78",
  "./assets/app.css?v=76f420b6",
  "./data/games.js?v=818a3ea1",
  "./assets/app.js?v=b389a3c6",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/fonts/press-start-2p-400-latin-ext.woff2",
  "./assets/fonts/press-start-2p-400-latin.woff2",
  "./assets/fonts/public-sans-var-latin-ext.woff2",
  "./assets/fonts/public-sans-var-latin.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Pages go to the network first, so a deploy shows up on the next visit rather
  // than being pinned to whatever was cached; falling back to cache when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Assets are served from cache immediately and refreshed in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
