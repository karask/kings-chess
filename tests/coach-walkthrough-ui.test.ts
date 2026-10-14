import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachWalkthrough } from "../src/CoachWalkthrough";
import { buildCoachingWalkthrough } from "../lib/coaching-walkthrough";
import { explainMove, type MoveAssessment } from "../lib/coaching";
import { parseUciMove } from "../lib/chess";

function assessment(beforeFen: string, move: string): MoveAssessment {
  const san = new Chess(beforeFen).move(parseUciMove(move)).san;
  return {
    beforeFen, playedMove: move, playedSan: san, bestMove: move, bestSan: san,
    classification: "best", playedLine: [move], bestLine: [move],
    ...explainMove({ beforeFen, playedMove: move, bestMove: move, bestLine: [move], playedLine: [move], classification: "best", family: "kia" }),
  };
}

function trialMarkup(value: MoveAssessment): string {
  const noop = () => {};
  return renderToStaticMarkup(createElement(CoachWalkthrough, {
    assessment: value, line: "played", step: 1, frames: buildCoachingWalkthrough(value, "played"),
    sans: [value.playedSan], trial: true, testing: false, busy: false, canTest: true,
    onLine: noop, onStep: noop, onTest: noop, onCancelTest: noop, onReturn: noop,
  }));
}

test("a best defensive trial still explains that its side remains worse", () => {
  const value = assessment(new Chess().fen(), "g1f3");
  value.playedScore = { type: "cp", value: -340 };
  assert.match(trialMarkup(value), /White remains worse, even if this is the best defense/);
});

test("a checkmating trial reports the win even when no engine search or score was needed", () => {
  const board = new Chess();
  for (const san of ["f3", "e5", "g4"]) board.move(san);
  const value = assessment(board.fen(), "d8h4");
  assert.equal(value.playedScore, undefined);
  const html = trialMarkup(value);
  assert.match(html, /This move gives checkmate. Black wins/);
  assert.doesNotMatch(html, /outcome is uncertain/);
});

test("bounded or unavailable scores cannot claim an experimental reply solved a threat", () => {
  const value = assessment(new Chess().fen(), "g1f3");
  value.playedScore = { type: "cp", value: 300, bound: "lower" };
  assert.match(trialMarkup(value), /outcome is uncertain/);
});
