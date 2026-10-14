import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import { parseUciMove } from "../lib/chess";
import { explainMove, type CoachingEvidence, type MoveAssessment } from "../lib/coaching";
import { buildCoachingWalkthrough } from "../lib/coaching-walkthrough";

function assessment(fen: string, line: string[], evidence: CoachingEvidence[] = []): MoveAssessment {
  let san = "";
  try { san = new Chess(fen).move(parseUciMove(line[0])).san; } catch { /* Invalid fixture tests the graceful fallback. */ }
  return {
    playedMove: line[0] ?? "e2e4", playedSan: san, bestMove: line[0] ?? "e2e4", bestSan: san,
    classification: "good", title: "A sound move", explanation: "", confidence: "limited",
    bestLine: line, playedLine: line, beforeFen: fen, evidence,
  };
}

test("walkthrough replays every legal move with local highlights and factual quiet-move narration", () => {
  const item = assessment(new Chess().fen(), ["e2e4", "e7e5", "g1f3"]);
  const frames = buildCoachingWalkthrough(item, "played");
  assert.equal(frames.length, 4);
  assert.equal(frames[0].ply, 0);
  assert.deepEqual(frames[0].squares, []);
  assert.equal(frames[1].title, "Your move: e4");
  assert.equal(frames[1].text, "Your pawn moves from e2 to e4.");
  assert.equal(frames[2].text, "Black's pawn moves from e7 to e5.");
  assert.equal(frames[3].move, "g1f3");
  assert.deepEqual(frames[3].squares, ["g1", "f3"]);
  assert.equal(new Chess(frames[3].fen).get("f3")?.type, "n");
  assert.doesNotMatch(frames.map((frame) => frame.text).join(" "), /forced|wins|best move|king safety/);
});

test("checks and mate explain their different consequences and highlight the checked king", () => {
  const check = buildCoachingWalkthrough(assessment("4k3/8/8/8/8/8/R7/4K3 w - - 0 1", ["a2a8"]), "played")[1];
  assert.match(check.title, /Ra8\+/);
  assert.match(check.text, /king on e8 is in check; the next move must answer it/);
  assert.ok(check.squares.includes("e8"));

  const board = new Chess(); board.move("f3"); board.move("e5");
  const mate = buildCoachingWalkthrough(assessment(board.fen(), ["g2g4", "d8h4"]), "played")[2];
  assert.match(mate.title, /Qh4#/);
  assert.match(mate.text, /checkmated.*no legal reply/);
  assert.ok(mate.squares.includes("e1"));
});

test("captures name the piece that was actually captured from the learner's perspective", () => {
  const item = assessment("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", ["e4d5"]);
  const capture = buildCoachingWalkthrough(item, "played")[1];
  assert.equal(capture.text, "Your pawn captures Black's pawn on d5.");
  const black = assessment("4k3/8/5n2/8/4P3/2N5/8/4K3 b - - 0 1", ["f6e4", "c3e4"]);
  assert.equal(buildCoachingWalkthrough(black, "played")[2].text, "White's knight captures your knight on e4.");
});

test("castling highlights both moved pieces without claiming that castling is always safer", () => {
  const item = assessment("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", ["e1g1", "e8c8"]);
  const frames = buildCoachingWalkthrough(item, "best");
  assert.equal(frames[1].title, "Alternative: O-O");
  assert.match(frames[1].text, /castle kingside.*king moves from e1 to g1.*rook from h1 to f1/);
  assert.deepEqual(frames[1].squares, ["e1", "g1", "h1", "f1"]);
  assert.match(frames[2].text, /Black castles queenside/);
  assert.deepEqual(frames[2].squares, ["e8", "c8", "a8", "d8"]);
  assert.doesNotMatch(frames[1].text, /saf/);
});

test("en passant highlights the separate capture square and promotion names the chosen piece", () => {
  const enPassant = buildCoachingWalkthrough(assessment("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", ["e5d6"]), "played")[1];
  assert.match(enPassant.text, /pawn on d5 en passant and lands on d6/);
  assert.deepEqual(enPassant.squares, ["e5", "d6", "d5"]);
  const promotion = buildCoachingWalkthrough(assessment("1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1", ["a7b8n"]), "played")[1];
  assert.match(promotion.text, /captures Black's rook on b8 and promotes to a knight/);
  assert.equal(new Chess(promotion.fen).get("b8")?.type, "n");
});

test("stalemate is identified separately from checkmate", () => {
  const frame = buildCoachingWalkthrough(assessment("k7/3Q4/2K5/8/8/8/8/8 w - - 0 1", ["d7c7"]), "played")[1];
  assert.match(frame.text, /no legal move and is not in check: this is stalemate/);
  assert.doesNotMatch(frame.text, /checkmated/);
});

test("timed evidence is scoped to its branch and exact stage, without future evidence highlights", () => {
  const item = assessment(new Chess().fen(), ["e2e4", "e7e5", "g1f3"], [{
    kind: "material", text: "A future summary must not appear on this move.", squares: ["a1", "a8"],
    line: "played", ply: 3,
    steps: [
      { ply: 0, text: "Compare the two candidate moves.", squares: ["g1"] },
      { ply: 1, text: "The pawn has left e2.", squares: ["e2", "e4", "invalid"] },
      { ply: 3, text: "The knight now stands on f3.", squares: ["f3"] },
    ],
  }]);
  const frames = buildCoachingWalkthrough(item, "played");
  assert.equal(frames[0].text, "Compare the two candidate moves.");
  assert.equal(frames[1].text, "The pawn has left e2.");
  assert.equal(frames[2].text, "Black's pawn moves from e7 to e5.");
  assert.equal(frames[3].text, "The knight now stands on f3.");
  assert.deepEqual(frames[1].squares, ["e2", "e4"]);
  assert.ok(frames.every((frame) => !frame.squares.includes("a8")));
  assert.equal(buildCoachingWalkthrough(item, "best")[1].text, "Your pawn moves from e2 to e4.");
});

test("old untagged evidence remains compatible without presenting its whole-line claim on every ply", () => {
  const item = assessment(new Chess().fen(), ["e2e4", "e7e5"], [{ kind: "material", text: "Whole-line summary", squares: ["a8"] }]);
  const frames = buildCoachingWalkthrough(item, "played");
  assert.ok(frames.every((frame) => !frame.text.includes("Whole-line") && !frame.squares.includes("a8")));
  assert.equal(frames.length, 3);
});

test("a verified fork's narrated stages follow its changing pieces without leaking onto the alternative", () => {
  const fen = "4k3/7p/8/8/8/4n3/7P/R3K3 w Q - 0 1";
  const playedLine = ["h2h3", "e3c2", "e1f2", "c2a1", "h3h4", "h7h6"];
  const bestLine = ["a1a2", "e3d5", "h2h3", "h7h6"];
  const explanation = explainMove({ beforeFen: fen, playedMove: "h2h3", bestMove: "a1a2", playedLine, bestLine, classification: "blunder", family: "kia" });
  const item: MoveAssessment = { ...assessment(fen, playedLine), ...explanation, classification: "blunder", bestMove: "a1a2", bestSan: "Ra2", bestLine };
  const frames = buildCoachingWalkthrough(item, "played");
  assert.match(frames[2].text, /king on e1.*rook on a1/);
  assert.ok(frames[2].squares.includes("e1"));
  assert.match(frames[4].text, /captures the rook/);
  assert.ok(!frames[4].squares.includes("e1"));
  assert.doesNotMatch(frames[1].text, /fork/);
  assert.ok(buildCoachingWalkthrough(item, "best").every((frame) => !frame.text.includes("forks your king")));
});

test("invalid continuations and root-mismatched lines do not display misleading legal prefixes", () => {
  const item = assessment(new Chess().fen(), ["e2e4", "e7e5", "e4e6"]);
  const frames = buildCoachingWalkthrough(item, "played");
  assert.equal(frames.length, 1);
  assert.match(frames[0].text, /continuation is unavailable/);
  assert.deepEqual(frames[0].squares, []);
  assert.equal(buildCoachingWalkthrough({ ...item, playedLine: ["d2d4"] }, "played").length, 1);
  assert.deepEqual(buildCoachingWalkthrough({ ...item, beforeFen: "invalid" }, "played"), []);
  assert.equal(buildCoachingWalkthrough({ ...item, playedLine: [] }, "played").length, 1);
});
