import assert from "node:assert/strict";
import test from "node:test";
import { appViewPath, resolveAppLocation, resolveAppView } from "../lib/navigation";
import { assetUrl } from "../lib/app-url";

test("retired and bookmarked training routes lead to the coached game", () => {
  for (const path of ["/", "/play", "/review", "/today", "/repertoire", "/tactics", "/progress", "/unknown", "/today/"]) {
    assert.equal(resolveAppView(path), "play", path);
    assert.equal(appViewPath(resolveAppView(path)), "/");
  }
});

test("utilities have dedicated routes but no training dashboard", () => {
  assert.equal(resolveAppView("/import"), "import");
  assert.equal(resolveAppView("/settings/"), "settings");
  assert.equal(appViewPath("import"), "/import");
  assert.equal(appViewPath("settings"), "/settings");
});

test("Pages links, deep bookmarks and engine assets stay inside the repository directory", () => {
  const base = "/kings-chess/";
  assert.equal(appViewPath("play", base), base);
  assert.equal(appViewPath("settings", base), `${base}#/settings`);
  assert.equal(appViewPath("import", base), `${base}#/import`);
  assert.equal(resolveAppLocation({ pathname: base, hash: "#/settings" }, base), "settings");
  assert.equal(resolveAppLocation({ pathname: base, hash: "#/review" }, base), "play");
  assert.equal(resolveAppLocation({ pathname: "/settings", hash: "" }, "/"), "settings");
  for (const file of ["engine/stockfish-18-lite-single.js", "stockfish-engine.worker.js", "data/puzzles.json", "sw.js"]) {
    assert.equal(assetUrl(file, base), `${base}${file}`);
    assert.equal(assetUrl(file, "/"), `/${file}`);
  }
});
