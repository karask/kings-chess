import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import { explainMove, replayCoachingLine, type CoachingEvidence } from "../lib/coaching";

function assessment(fen: string, playedLine: string[], bestLine: string[], classification: "blunder" | "best" = "blunder") {
  assert.equal(replayCoachingLine(fen, playedLine).legal, true, "fixture's played line is legal");
  assert.equal(replayCoachingLine(fen, bestLine).legal, true, "fixture's alternative is legal");
  return explainMove({ beforeFen: fen, playedMove: playedLine[0], bestMove: bestLine[0], playedLine, bestLine, classification, family: "kia" });
}

function mechanism(evidence: CoachingEvidence[], kind: CoachingEvidence["kind"]) {
  const result = evidence.find((item) => item.kind === kind);
  assert.ok(result, `expected ${kind} evidence`);
  return result;
}

test("a dropped bishop identifies the capturer, the missing recapture, and how the alternative avoids it", () => {
  const result = assessment("r5k1/7p/8/8/8/2B5/7P/6K1 w - - 0 1",
    ["c3a5", "a8a5", "h2h3", "h7h6"], ["c3d4", "a8a7", "h2h3", "h7h6"]);
  const hanging = mechanism(result.evidence, "hanging-piece");
  assert.match(hanging.text, /no legal immediate recapture/);
  assert.deepEqual(hanging.steps?.map((step) => step.ply), [1, 2]);
  assert.match(hanging.steps![0].text, /rook on a8/);
  const alternative = mechanism(result.evidence, "defense");
  assert.equal(alternative.line, "best");
  assert.equal(alternative.ply, 1);
  assert.match(alternative.text, /moves your bishop to d4/);
  assert.match(result.explanation, /moves your bishop to d4/);
});

test("identical SAN captures name the actor and explain a knight-for-pawn trade", () => {
  const result = assessment("rnbqk2r/ppp1ppbp/3p1np1/8/3PPP2/2N2N2/PPP3PP/R1BQKB1R b KQkq - 1 5",
    ["f6e4", "c3e4", "e8g8", "f1e2"], ["e8g8", "f1d3", "c7c5", "d4d5"]);
  const hanging = mechanism(result.evidence, "hanging-piece");
  assert.match(hanging.text, /Your Nxe4 takes a pawn, but White can reply Nxe4/);
  assert.match(hanging.text, /traded your knight for a pawn/);
  assert.match(hanging.steps![1].text, /White's Nxe4 captures your knight/);
  assert.doesNotMatch(hanging.text, /nxe4/);
});

test("moving a defender explains the recapture that disappeared", () => {
  const result = assessment("r5k1/7p/8/8/8/2B5/7P/R5K1 w - - 0 1",
    ["c3d2", "a8a1", "g1f2", "h7h6"], ["a1b1", "a8a7", "h2h3", "h7h6"]);
  const defender = mechanism(result.evidence, "defender");
  assert.match(defender.text, /moves the bishop away from c3/);
  assert.match(defender.text, /removing its recapture on a1/);
  assert.equal(defender.line, "played");
  assert.match(result.explanation, /removing its recapture/);
});

test("a defender moving along the same diagonal is not falsely described as abandoning its piece", () => {
  const result = assessment("r5k1/7p/8/8/8/2B5/7P/R5K1 w - - 0 1",
    ["c3d4", "a8a1", "g1f2", "h7h6"], ["a1b1", "a8a7", "h2h3", "h7h6"]);
  assert.equal(result.evidence.some((item) => item.kind === "defender" || item.kind === "hanging-piece"), false);
  assert.doesNotMatch(result.explanation, /no legal immediate recapture/);
});

test("an absolute pin explains why an apparent defender cannot legally recapture", () => {
  const result = assessment("4r1k1/7p/8/8/5n2/3N4/4B2P/4K3 w - - 0 1",
    ["h2h3", "f4d3", "e1f1", "h7h6"], ["d3b4", "f4g6", "h2h3", "h7h6"]);
  const pin = mechanism(result.evidence, "pin");
  assert.match(pin.text, /bishop on e2/);
  assert.match(pin.text, /king on e1/);
  assert.match(pin.text, /piece on e8/);
  assert.match(pin.text, /recapture is illegal/);
  assert.deepEqual(pin.squares, ["f4", "d3", "e2", "e1", "e8"]);
  assert.equal(pin.ply, 2);
});

test("a recapture of the pinner is not blamed on a pin when a discovered check prevents it", () => {
  const result = assessment("6k1/7p/8/8/1b6/2r1P3/4R2P/4K3 w - - 0 1",
    ["h2h3", "c3e3", "e1f1", "h7h6"], ["e3e4", "c3c6", "e1f1", "h7h6"]);
  assert.equal(result.evidence.some((item) => item.kind === "pin"), false);
  assert.doesNotMatch(result.explanation, /pinned to the king/);
});

test("an off-ray recapture is not attributed to a pin when removing the pinner leaves another check", () => {
  const result = assessment("4r1k1/7p/8/4N3/1b6/2r2P2/7P/4K3 w - - 0 1",
    ["h2h3", "c3f3", "e1d1", "h7h6"], ["f3f4", "c3c6", "e1d1", "h7h6"]);
  assert.equal(result.evidence.some((item) => item.kind === "pin"), false);
  assert.doesNotMatch(result.explanation, /pinned to the king/);
});

test("moving a blocker explains the newly exposed slider attack", () => {
  const result = assessment("r5k1/7p/8/8/B7/8/7P/R5K1 w - - 0 1",
    ["a4b5", "a8a1", "g1f2", "h7h6"], ["a1b1", "a8a7", "h2h3", "h7h6"]);
  const discovery = mechanism(result.evidence, "discovered-attack");
  assert.match(discovery.text, /opens the rook's line from a8 to a1/);
  assert.deepEqual(discovery.steps?.map((step) => step.ply), [1, 2]);
});

test("capturing a defender explains the later capture of the formerly protected piece", () => {
  const result = assessment("r5k1/7p/8/8/1b6/2B5/4N2P/R5K1 w - - 0 1",
    ["h2h3", "b4c3", "e2c3", "a8a1", "g1f2", "h7h6"], ["a1b1", "a8a7", "h2h3", "h7h6"]);
  const defender = mechanism(result.evidence, "defender");
  assert.match(defender.text, /removes the bishop on c3/);
  assert.match(defender.text, /could recapture on a1/);
  assert.deepEqual(defender.steps?.map((step) => step.ply), [2, 4]);
});

test("a pawn fork can be explained without requiring check or a knight", () => {
  const result = assessment("6k1/7p/8/8/3p4/8/2N1R2P/6K1 w - - 0 1",
    ["h2h3", "d4d3", "c2b4", "d3e2", "g1f2", "h7h6"], ["e2e4", "d4d3", "c2e3", "h7h6"]);
  const fork = mechanism(result.evidence, "fork");
  assert.match(fork.text, /forks your knight on c2 and rook on e2/);
  assert.deepEqual(fork.steps?.map((step) => step.ply), [2, 4]);
  assert.match(result.title, /allows a fork/);
});

test("a sound retreat gets a specific defensive explanation", () => {
  const line = ["a5b4", "a8a7", "h2h3"];
  const result = assessment("r5k1/7p/8/B7/8/8/7P/6K1 w - - 0 1", line, line, "best");
  const defense = mechanism(result.evidence, "defense");
  assert.match(defense.text, /moves your bishop away from Black's rook on a8/);
  assert.match(defense.text, /On b4 it cannot be captured immediately/);
  assert.equal(result.confidence, "verified");
});

test("a double pawn push is not praised as uncapturable when en passant remains legal", () => {
  const fen = "6k1/7p/8/8/3p1n2/8/4P2P/6K1 w - - 0 1";
  const line = ["e2e4", "h7h6", "h2h3"];
  const after = new Chess(fen);
  after.move({ from: "e2", to: "e4" });
  assert.ok(after.moves({ verbose: true }).some((move) => move.from === "d4" && move.to === "e3" && move.isEnPassant()));
  const result = assessment(fen, line, line, "best");
  assert.equal(result.evidence.some((item) => item.kind === "defense"), false);
  assert.doesNotMatch(result.explanation, /cannot be captured immediately/);
});

test("the alternative does not claim pawn safety by overlooking an en passant victim square", () => {
  const result = assessment("6k1/7p/8/8/3p1n2/8/4P2P/6K1 w - - 0 1",
    ["h2h3", "f4e2", "g1f2", "h7h6"], ["e2e4", "h7h6", "h2h3"]);
  assert.equal(result.evidence.some((item) => item.kind === "defense" && item.line === "best"), false);
  assert.doesNotMatch(result.explanation, /no legal immediate capture of it/);
});

test("adding a defender cites a legal capture and recapture rather than geometric protection", () => {
  const line = ["e3d4", "a8a7", "h2h3"];
  const result = assessment("r5k1/7p/8/8/8/4B3/7P/R5K1 w - - 0 1", line, line, "best");
  const defense = mechanism(result.evidence, "defense");
  assert.match(defense.text, /defender of the rook on a1/);
  assert.match(defense.text, /Rxa1\+, Bxa1 is a legal recapture/);
});

test("a pinned apparent defender receives no invented defensive praise", () => {
  const line = ["e2e3", "g8h8", "h2h3"];
  const result = assessment("4r1k1/7p/8/1b6/8/3N4/4R2P/4K3 w - - 0 1", line, line, "best");
  assert.equal(result.evidence.some((item) => item.kind === "defense"), false);
  assert.equal(result.confidence, "limited");
});

test("tactical mechanism claims retain the unfinished-exchange safeguard", () => {
  const result = assessment("4r1k1/7p/8/8/5n2/3N4/4B2P/4K3 w - - 0 1",
    ["h2h3", "f4d3"], ["d3b4", "f4g6", "h2h3", "h7h6"]);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.confidence, "limited");
});

test("all narration metadata names actual positions in its own legal branch", () => {
  const fen = "r5k1/7p/8/8/1b6/2B5/4N2P/R5K1 w - - 0 1";
  const played = ["h2h3", "b4c3", "e2c3", "a8a1", "g1f2", "h7h6"];
  const best = ["a1b1", "a8a7", "h2h3", "h7h6"];
  for (const item of assessment(fen, played, best).evidence) {
    assert.ok(item.line);
    const replay = replayCoachingLine(fen, item.line === "played" ? played : best);
    for (const stage of [{ ply: item.ply!, text: item.text, squares: item.squares }, ...(item.steps ?? [])]) {
      assert.ok(stage.ply >= 1 && stage.ply <= replay.moves.length);
      assert.doesNotThrow(() => new Chess(replay.fens[stage.ply]));
      assert.ok(stage.squares.every((square) => /^[a-h][1-8]$/.test(square)));
    }
  }
});
