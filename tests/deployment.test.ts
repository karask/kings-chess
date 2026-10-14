import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function worker(base: string) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const installed: string[] = [];
  const removed: string[] = [];
  const items = new Map<string, Response>();
  const root = `https://example.test${base}`;
  const cache = {
    async addAll(urls: string[]) {
      installed.push(...urls);
      for (const url of urls) items.set(url, new Response(url === root
        ? `<script src="${base}assets/app.js"></script><link href="${base}assets/app.css"><link href="/other/assets/unrelated.js">`
        : "cached asset"));
    },
    async match(request: string | Request) { return items.get(typeof request === "string" ? request : request.url)?.clone(); },
    async put(request: Request, response: Response) { items.set(request.url, response); },
  };
  const caches = {
    async open() { return cache; },
    match: cache.match,
    async keys() { return [`kings-study:${base}:old`, "kings-study:/other/:old", "unrelated-app"]; },
    async delete(key: string) { removed.push(key); return true; },
  };
  vm.runInNewContext(source, {
    URL, caches,
    fetch: async () => { throw new Error("offline"); },
    self: {
      location: { href: `${root}sw.js` },
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    },
  });
  async function lifecycle(name: string) {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  }
  async function request(path: string, mode: string) {
    let pending: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request: { url: `https://example.test${path}`, method: "GET", mode },
      respondWith: (promise: Promise<Response>) => { pending = promise; }, waitUntil: () => {},
    });
    return pending;
  }
  return { installed, removed, lifecycle, request };
}

test("root and Pages deployments cache the correct shell, puzzles, WASM and fingerprinted assets", async () => {
  for (const base of ["/", "/kings-chess/"]) {
    const app = worker(base);
    await app.lifecycle("install");
    for (const path of ["", "data/puzzles.json", "engine/stockfish-18-lite-single.wasm", "assets/app.js", "assets/app.css"]) {
      assert.ok(app.installed.includes(`https://example.test${base}${path}`), path);
    }
    assert.ok(!app.installed.includes("https://example.test/other/assets/unrelated.js"));
    assert.equal(await (await app.request(`${base}assets/app.js`, "cors"))?.text(), "cached asset");
    assert.match(await (await app.request(`${base}settings`, "navigate"))!.text(), /assets\/app.js/);
  }
});

test("Pages worker preserves other applications' caches and ignores their requests", async () => {
  const app = worker("/kings-chess/");
  await app.lifecycle("activate");
  assert.deepEqual(app.removed, ["kings-study:/kings-chess/:old"]);
  assert.equal(await app.request("/other/app.js", "cors"), undefined);
});
