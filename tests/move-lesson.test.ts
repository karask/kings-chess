import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoveLesson } from "../src/MoveLesson";
import type { MoveAssessment } from "../lib/coaching";

const lesson: NonNullable<MoveAssessment["lesson"]> = {
  theme: "Meet the central challenge",
  yourMove: "Your knight leaves f6, reducing your control of e4.",
  opponentReply: "White can now advance e4 to gain central space.",
  alternative: "The knight on d7 continues to support the e5 break.",
  takeaway: "Prepare the central break before starting a wing attack.",
  basis: "position",
};

test("lesson compares the move, reply and alternative without implying a sound move needs correction", () => {
  for (const classification of ["excellent", "good", "unrated"] as const) {
    const html = renderToStaticMarkup(createElement(MoveLesson, { lesson, bestSan: "Nbd7", classification }));
    assert.match(html, /Your move/);
    assert.match(html, /Opponent’s response/);
    assert.match(html, /Alternative: Nbd7/);
    assert.match(html, /Remember/);
    assert.doesNotMatch(html, /Why Nbd7 helps|Checked response/);
  }
  const html = renderToStaticMarkup(createElement(MoveLesson, {
    lesson: { ...lesson, responseCheck: "After Nbd7, the same e4 advance is still legal." },
    bestSan: "Nbd7", classification: "mistake",
  }));
  assert.match(html, /Why Nbd7 helps/);
  assert.match(html, /Checked response:.*After Nbd7/);
});

test("a one-move lesson omits unavailable branches and treats chess explanations as text", () => {
  const html = renderToStaticMarkup(createElement(MoveLesson, {
    lesson: { theme: "Development", yourMove: "<script>unsafe()</script>", takeaway: "Develop the knight.", basis: "position" },
    bestSan: "Nf3", classification: "best",
  }));
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|Opponent’s response|Alternative:|Why Nf3 helps|Checked response/);
  assert.match(html, /Develop the knight/);
});
