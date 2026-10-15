import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RetryActions } from "../src/RetryActions";
import type { MoveAssessment } from "../lib/coaching";

test("continuation is available for weak and uncertain candidates and explains replaced future moves", () => {
  for (const classification of ["best", "blunder", "unrated"] as const) {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(RetryActions, {
      assessment: { playedSan: "e4", classification } as MoveAssessment,
      laterPlies: 4, disabled: false, onContinue: noop, onTryAnother: noop, onShowLine: noop,
    }));
    assert.match(html, /Continue from this move/);
    assert.match(html, /replace the 4 later moves/);
    assert.match(html, /original line stays available/);
    assert.doesNotMatch(html, /disabled/);
  }
});
