const CACHE_VERSION = "kings-study-v14-explain-and-explore";
const CORE = [
  "/",
  "/today",
  "/repertoire",
  "/tactics",
  "/review",
  "/import",
  "/progress",
  "/settings",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/og.png",
  "/data/puzzles.json",
  "/data/puzzle-manifest.json",
  "/stockfish-engine.worker.js",
  "/engine/stockfish-18-lite-single.js",
  "/engine/stockfish-18-lite-single.wasm",
  "/engine/COPYING.txt",
  "/THIRD_PARTY_NOTICES.txt"
];

async function precache() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(CORE);

  // Vite fingerprints the application JS and CSS. Discover those URLs from
  // the cached shell so the very first successful production load is enough
  // for a later offline start.
  const shell = await cache.match("/");
  if (shell) {
    const html = await shell.text();
    const fingerprinted = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)]
      .map((match) => match[1]);
    if (fingerprinted.length) await cache.addAll([...new Set(fingerprinted)]);
  }
  await self.skipWaiting();
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || (await caches.match("/")) || (await caches.match("/offline.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Versioned app releases refresh the cache at install. A cache hit must
      // not start an unhandled network request while the app is offline.
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
