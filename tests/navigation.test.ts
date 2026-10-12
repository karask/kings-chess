import assert from "node:assert/strict";
import test from "node:test";
import { appViewPath, resolveAppView } from "../lib/navigation";

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
