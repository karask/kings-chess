const BASE = new URL("./", self.location.href);
const CACHE_PREFIX = `kings-study:${BASE.pathname}:`;
const CACHE_VERSION = `${CACHE_PREFIX}v16-continue-retry`;
const asset = (path) => new URL(path, BASE).href;
const CORE = [
  "./", "offline.html", "manifest.webmanifest", "favicon.svg", "og.png",
  "data/puzzles.json", "data/puzzle-manifest.json", "stockfish-engine.worker.js",
  "engine/stockfish-18-lite-single.js", "engine/stockfish-18-lite-single.wasm",
  "engine/COPYING.txt", "THIRD_PARTY_NOTICES.txt",
].map(asset);

async function precache() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(CORE);
  const shell = await cache.match(BASE.href);
  if (shell) {
    const html = await shell.text();
    const fingerprinted = [...html.matchAll(/(?:src|href)="([^"?#]+)"/g)]
      .map((match) => new URL(match[1], BASE))
      .filter((url) => url.origin === BASE.origin && url.pathname.startsWith(`${BASE.pathname}assets/`))
      .map((url) => url.href);
    if (fingerprinted.length) await cache.addAll([...new Set(fingerprinted)]);
  }
  await self.skipWaiting();
}

self.addEventListener("install", (event) => event.waitUntil(precache()));
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION
      && (key.startsWith(CACHE_PREFIX) || (BASE.pathname === "/" && key.startsWith("kings-study-v"))))
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;

  const cachedShell = async () => (await caches.match(event.request))
    || (await caches.match(BASE.href)) || (await caches.match(asset("offline.html")));
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (!response.ok) return cachedShell().then((cached) => cached || response);
      const clone = response.clone();
      event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone)));
      return response;
    }).catch(cachedShell));
    return;
  }

  event.respondWith(caches.open(CACHE_VERSION).then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const clone = response.clone();
      event.waitUntil(cache.put(event.request, clone));
    }
    return response;
  }));
});
