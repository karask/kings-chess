import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import { evaluationFromAnalysis, formatEvaluation, terminalEvaluation, whiteShare } from "../lib/evaluation";
import type { EngineAnalysis, EngineScore } from "../lib/types";

const initial = new Chess().fen();
const afterE4 = new Chess();
afterE4.move("e4");

function analysis(fen: string, move: string, score?: EngineScore): EngineAnalysis {
  return {
    generation: 1, fen, perspective: new Chess(fen).turn(), bestMove: move,
    ponderMove: null, elapsedMs: 1,
    lines: [{ multipv: 1, depth: 12, pv: [move], ...(score ? { score } : {}) }],
  };
}

test("engine evaluations are normalized to White, including a Black root", () => {
  assert.deepEqual(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "cp", value: 125 })), { kind: "cp", value: 125 });
  assert.deepEqual(evaluationFromAnalysis(analysis(afterE4.fen(), "e7e5", { type: "cp", value: 75 })), { kind: "cp", value: -75 });
  assert.deepEqual(evaluationFromAnalysis(analysis(afterE4.fen(), "e7e5", { type: "cp", value: -125 })), { kind: "cp", value: 125 });
  assert.equal(formatEvaluation(evaluationFromAnalysis(analysis(afterE4.fen(), "e7e5", { type: "cp", value: 75 }))), "-0.75");
});

test("signed mate evaluations use an explicit winning colour", () => {
  assert.deepEqual(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "mate", value: 3 })), { kind: "mate", value: 3, winner: "w" });
  assert.deepEqual(evaluationFromAnalysis(analysis(afterE4.fen(), "e7e5", { type: "mate", value: 3 })), { kind: "mate", value: -3, winner: "b" });
  assert.deepEqual(evaluationFromAnalysis(analysis(afterE4.fen(), "e7e5", { type: "mate", value: -3 })), { kind: "mate", value: 3, winner: "w" });
  assert.equal(formatEvaluation({ kind: "mate", value: 3, winner: "w" }), "+M3");
  assert.equal(formatEvaluation({ kind: "mate", value: -3, winner: "b" }), "-M3");
  assert.equal(whiteShare({ kind: "mate", value: 3, winner: "w" }), 100);
  assert.equal(whiteShare({ kind: "mate", value: -3, winner: "b" }), 0);
});

test("last exact completed iteration is preferred without relabeling a bound", () => {
  const result = analysis(initial, "e2e4", { type: "cp", value: 31, bound: "lower" });
  result.completedLines = [{ multipv: 1, depth: 11, pv: ["e2e4", "e7e5"], score: { type: "cp", value: 23 } }];
  assert.deepEqual(evaluationFromAnalysis(result), { kind: "cp", value: 23 });
  assert.deepEqual(result.lines[0].score, { type: "cp", value: 31, bound: "lower" });
});

test("stale roots, bound-only results, and secondary MultiPV scores stay unknown", () => {
  const bounded = analysis(initial, "d2d4", { type: "cp", value: 31, bound: "lower" });
  bounded.completedLines = [{ multipv: 1, depth: 11, pv: ["e2e4"], score: { type: "cp", value: 23 } }];
  assert.equal(evaluationFromAnalysis(bounded), null);
  assert.equal(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "cp", value: 30, bound: "upper" })), null);
  const secondary = analysis(initial, "e2e4", { type: "cp", value: 30 });
  secondary.lines[0].multipv = 2;
  assert.equal(evaluationFromAnalysis(secondary), null);
  const mismatched = analysis(initial, "e2e4", { type: "cp", value: 30 });
  mismatched.lines[0].pv = ["d2d4"];
  assert.equal(evaluationFromAnalysis(mismatched), null);
  const current = analysis(initial, "d2d4", { type: "cp", value: 20 });
  current.completedLines = bounded.completedLines;
  assert.deepEqual(evaluationFromAnalysis(current), { kind: "cp", value: 20 }, "an exact current-root line remains usable");
});

test("missing, malformed, nonfinite and ambiguous mate-zero scores are not fake zero", () => {
  assert.equal(evaluationFromAnalysis(null), null);
  assert.equal(evaluationFromAnalysis(undefined), null);
  assert.equal(evaluationFromAnalysis(analysis(initial, "e2e4")), null);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "cp", value })), null);
  }
  assert.equal(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "mate", value: 0 })), null);
  assert.equal(evaluationFromAnalysis(analysis(initial, "e2e4", { type: "mate", value: 1.5 })), null);
  assert.equal(evaluationFromAnalysis(analysis(initial, "e2e5", { type: "cp", value: 30 })), null);
  const wrongPerspective = analysis(initial, "e2e4", { type: "cp", value: 30 });
  wrongPerspective.perspective = "b";
  assert.equal(evaluationFromAnalysis(wrongPerspective), null);
  const wrongFen = analysis(initial, "e2e4", { type: "cp", value: 30 });
  wrongFen.fen = "not a FEN";
  assert.equal(evaluationFromAnalysis(wrongFen), null);
  assert.equal(formatEvaluation(null), "—");
  assert.equal(whiteShare(null), null);
  assert.equal(formatEvaluation({ kind: "cp", value: Number.NaN }), "—");
  assert.equal(whiteShare({ kind: "cp", value: Number.POSITIVE_INFINITY }), null);
});

test("formatting and visual cp share are symmetric, bounded and distinct from win probability", () => {
  assert.equal(formatEvaluation({ kind: "cp", value: 125 }), "+1.25");
  assert.equal(formatEvaluation({ kind: "cp", value: -75 }), "-0.75");
  assert.equal(formatEvaluation({ kind: "cp", value: -0 }), "0.00");
  assert.equal(whiteShare({ kind: "cp", value: 0 }), 50);
  for (const value of [1, 75, 400, 1_000, 10_000, Number.MAX_VALUE]) {
    const positive = whiteShare({ kind: "cp", value })!;
    const negative = whiteShare({ kind: "cp", value: -value })!;
    assert.ok(positive > 50 && positive <= 96);
    assert.ok(negative < 50 && negative >= 4);
    assert.ok(Math.abs(positive + negative - 100) < 0.000_001);
  }
});

test("terminal checkmate records the winner even when mate distance is zero", () => {
  const blackWins = new Chess();
  for (const move of ["f3", "e5", "g4", "Qh4#"]) blackWins.move(move);
  const black = terminalEvaluation(blackWins);
  assert.deepEqual(black, { kind: "mate", value: -0, winner: "b" });
  assert.equal(formatEvaluation(black), "-M0");
  assert.equal(whiteShare(black), 0);
  assert.equal(formatEvaluation(JSON.parse(JSON.stringify(black))), "-M0", "winner survives JSON dropping negative zero");
  const whiteWins = new Chess();
  for (const move of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]) whiteWins.move(move);
  assert.deepEqual(terminalEvaluation(whiteWins), { kind: "mate", value: 0, winner: "w" });
  assert.equal(formatEvaluation(terminalEvaluation(whiteWins)), "+M0");
  assert.equal(whiteShare(terminalEvaluation(whiteWins)), 100);
});

test("terminal draws include stalemate, insufficient material, fifty moves and full-history repetition", () => {
  const drawn = { kind: "draw", value: 0 } as const;
  assert.deepEqual(terminalEvaluation(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")), drawn);
  assert.deepEqual(terminalEvaluation(new Chess("7k/8/8/8/8/8/8/K7 w - - 0 1")), drawn);
  assert.deepEqual(terminalEvaluation(new Chess("7k/8/8/8/8/8/P7/K7 w - - 100 70")), drawn);
  const repeated = new Chess();
  for (const move of ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]) repeated.move(move);
  const before = repeated.history();
  assert.deepEqual(terminalEvaluation(repeated), drawn);
  assert.deepEqual(repeated.history(), before, "terminal checks do not alter game history");
  assert.equal(terminalEvaluation(new Chess(repeated.fen())), null, "a FEN alone cannot establish repetition");
  assert.equal(terminalEvaluation(new Chess()), null);
  assert.equal(formatEvaluation(drawn), "0.00");
  assert.equal(whiteShare(drawn), 50);
});
