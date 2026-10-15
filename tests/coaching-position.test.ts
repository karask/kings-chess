import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import { moveToUci } from "../lib/chess";
import { positionalLesson, type PositionLessonInput } from "../lib/coaching-position";

function position(moves: string[]): string {
  const board = new Chess();
  for (const move of moves) board.move(move);
  return board.fen();
}

function branch(beforeFen: string, moves: string[]): string[] {
  const board = new Chess(beforeFen);
  return moves.map((move) => moveToUci(board.move(move)));
}

function lesson(beforeFen: string, played: string[], best = played,
  options: Partial<Pick<PositionLessonInput, "classification" | "family">> = {}) {
  const playedLine = branch(beforeFen, played);
  const bestLine = branch(beforeFen, best);
  return positionalLesson({ beforeFen, playedMove: playedLine[0], bestMove: bestLine[0], playedLine, bestLine,
    classification: "best", family: "kia", ...options });
}

const CLOSED_KID = position(["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6", "d5", "Ne7", "Ne1"]);
const KIA_CENTRE = position(["Nf3", "d5", "g3", "Nf6", "Bg2", "e6", "O-O", "Be7", "d3", "O-O", "e4", "Nc6"]);

test("quiet alternatives explain actual development and central squares", () => {
  const result = lesson(new Chess().fen(), ["a3", "d5"], ["Nf3", "d5"], { classification: "inaccuracy" })!;
  assert.match(result.yourMove, /pawn from a2 to a3/);
  assert.match(result.alternative!, /develops the knight from its starting square g1/);
  assert.match(result.alternative!, /d4 and e5/);
  assert.match(result.opponentReply!, /d5/);
  assert.ok(result.evidence.some((fact) => fact.line === "best" && fact.ply === 1 && fact.squares.includes("e5")));
  assert.doesNotMatch(JSON.stringify(result), /prevents|wins|causes|loses/);
});

test("initial pawn advances have a specific central task, not just narration", () => {
  const result = lesson(new Chess().fen(), ["e4", "c5"])!;
  assert.match(result.yourMove, /controls the empty central square d5/);
  assert.match(result.takeaway, /control an entry square/);
});

test("good alternatives are described as different playable plans", () => {
  const result = lesson(new Chess().fen(), ["Nf3", "d5"], ["e4", "c5"], { classification: "excellent" })!;
  assert.match(result.alternative!, /Another playable option/);
  assert.match(result.alternative!, /without your move being a mistake/);
  assert.match(result.opponentReply!, /d5/);
  assert.match(result.alternative!, /c5/);
  assert.match(result.takeaway, /Develop toward a specific job/);
  assert.doesNotMatch(result.alternative!, /prevents d5|forces c5/);
});

test("the same root does not generate a pretend alternative", () => {
  const result = lesson(new Chess().fen(), ["Nf3", "d5"])!;
  assert.equal(result.alternative, undefined);
  assert.ok(result.evidence.every((fact) => fact.line === "played"));
});

test("both generic moves produce no lesson", () => {
  assert.equal(lesson(new Chess().fen(), ["a3", "h6"], ["h3", "a6"]), undefined);
});

test("a useful played observation still retains the actual alternative when its purpose is unknown", () => {
  const result = lesson(new Chess().fen(), ["Nf3", "d5"], ["a3", "e5"], { classification: "inaccuracy" })!;
  assert.match(result.alternative!, /a3 moves your pawn from a2 to a3/);
  assert.match(result.alternative!, /purpose has not yet been established/);
  assert.match(result.alternative!, /e5/);
  assert.ok(result.evidence.some((fact) => fact.line === "best" && fact.ply === 2));
});

test("Pirc central breaks identify legal tension and the opponent's actual capture", () => {
  const before = position(["e4", "d6", "d4", "Nf6", "Nc3", "g6", "Nf3", "Bg7", "Be2", "O-O", "O-O"]);
  const result = lesson(before, ["c5", "dxc5"], ["e5", "d5"], { family: "pirc", classification: "good" })!;
  assert.match(result.yourMove, /c5.*d4 pawn/);
  assert.match(result.yourMove, /White can answer dxc5/);
  assert.match(result.opponentReply!, /dxc5 captures the pawn on c5/);
  assert.match(result.alternative!, /e5.*d4 pawn/);
  assert.equal(result.evidence.length, 4);
});

test("closed KID knight retreat connects f6 to the legal f7-f5 break", () => {
  const result = lesson(CLOSED_KID, ["Ne8", "f3"], ["Nh5", "f3"], { family: "kid", classification: "good" })!;
  assert.match(result.yourMove, /vacates f6.*f7 pawn's path toward f5/);
  assert.match(result.yourMove, /legally available on a later Black turn/);
  assert.match(result.takeaway, /Recheck the position after White's reply/);
});

test("closed KID f5 explanation does not promise that a thematic break is timely", () => {
  const board = new Chess(CLOSED_KID); board.move("Ne8"); board.move("f3");
  const result = lesson(board.fen(), ["f5", "exf5"], undefined, { family: "kid" })!;
  assert.match(result.yourMove, /capture against White's e4 pawn/);
  assert.match(result.takeaway, /e5 support.*king.*counterplay/);
  assert.match(result.takeaway, /not automatically timely/);
  assert.match(result.opponentReply!, /exf5 captures the pawn on f5/);
});

test("selected family alone does not manufacture a closed King's Indian structure", () => {
  const unrelated = lesson(position(["Nf3"]), ["Nf6", "g3"], undefined, { family: "kid" })!;
  assert.doesNotMatch(JSON.stringify(unrelated), /King's Indian pawn break|closed centre/);
  const wrongSide = lesson(new Chess().fen(), ["Nf3", "d5"], undefined, { family: "kid" })!;
  assert.doesNotMatch(JSON.stringify(wrongSide), /King's Indian pawn break/);
  const wrongFamily = lesson(CLOSED_KID, ["Ne8", "f3"], undefined, { family: "kia" })!;
  assert.doesNotMatch(JSON.stringify(wrongFamily), /King's Indian pawn break/);
});

test("KIA e5 explains the actual lock and surviving d5 tension", () => {
  const result = lesson(KIA_CENTRE, ["e5", "Nd7"])!;
  assert.match(result.yourMove, /locks against Black's e6 pawn/);
  assert.match(result.yourMove, /control d6 and f6/);
  assert.match(result.yourMove, /d5 pawn remains.*not completely locked/);
  assert.match(result.takeaway, /central breaks/);
});

test("KIA c4 is a central challenge and can have a concrete dxc4 reply", () => {
  const result = lesson(KIA_CENTRE, ["c4", "dxc4"])!;
  assert.match(result.yourMove, /c-pawn to challenge Black's pawn on d5/);
  assert.match(result.opponentReply!, /dxc4 captures the pawn on c4/);
  assert.match(result.takeaway, /does not require a kingside attack/);
});

test("the KIA e5 plan requires the relevant fianchetto and d3 setup", () => {
  const unrelated = "4k3/8/4p3/3p4/4P3/8/8/4K3 w - - 0 1";
  assert.equal(lesson(unrelated, ["e5", "Kd7"]), undefined);
});

test("pinned pawns do not get credited with legal diagonal control", () => {
  const pinned = "k3r3/8/8/3p4/4P3/3P4/6BP/4K3 w - - 0 1";
  const result = lesson(pinned, ["e5", "Kb7"])!;
  assert.match(result.yourMove, /no legal pawn capture on d6 or f6/);
  assert.doesNotMatch(result.yourMove, /can control d6|can control f6/);
});

test("king-occupied target squares are not mistaken for a pinned pawn", () => {
  const result = lesson("8/8/3K1k2/3p4/4P3/3P4/6B1/8 w - - 0 1", ["e5+", "Kg6"])!;
  assert.doesNotMatch(result.yourMove, /pinned/);
});

test("pinned knight rerouting does not claim central support it cannot supply", () => {
  const before = "k3r3/8/8/8/3P4/2N5/8/4K3 w - - 0 1";
  // Ne2 blocks the check but remains pinned, so geometric d4 access is not
  // a legal recapture. The tactical layer can describe the check response.
  assert.equal(lesson(before, ["Ne2", "Kb7"]), undefined);
});

test("fianchetto activity reports the first blocker instead of inventing an attack", () => {
  const before = position(["Nf3", "d5", "g3", "Nf6"]);
  const result = lesson(before, ["Bg2", "e6"])!;
  assert.match(result.yourMove, /knight on f3 is the first blocker/);
  assert.match(result.takeaway, /account for your knight on f3/);
  assert.doesNotMatch(result.yourMove, /attacks d5|pressures d5/);
});

test("moving a blocker opens only the actually visible bishop diagonal", () => {
  const result = lesson(KIA_CENTRE, ["Nh4", "dxe4"])!;
  assert.match(result.yourMove, /opens more squares along the g2 bishop's diagonal/);
  assert.match(result.yourMove, /open through f3.*pawn on e4 is the first blocker/);
  assert.doesNotMatch(result.yourMove, /attacks d5/);
});

test("a fianchetto bishop capturing along its diagonal is not said to abandon it", () => {
  const before = "4k3/1r6/8/8/8/8/6B1/4K3 w - - 0 1";
  const result = lesson(before, ["Bxb7", "Kd7"])!;
  assert.match(result.yourMove, /bishop now works from b7/);
  assert.doesNotMatch(result.yourMove, /former diagonal is no longer covered/);
});

test("castling gives factual placement and shield information without a safety verdict", () => {
  const before = position(["Nf3", "d5", "g3", "Nf6", "Bg2", "e6"]);
  const result = lesson(before, ["O-O", "Be7"])!;
  assert.match(result.yourMove, /king from e1 to g1.*h1 rook to f1/);
  assert.match(result.yourMove, /pawns on f2, h2/);
  assert.doesNotMatch(result.yourMove, /king is safe|activates/);
});

test("malformed positions, illegal tail moves, and mismatched roots produce no evidence", () => {
  const input: PositionLessonInput = { beforeFen: new Chess().fen(), playedMove: "g1f3", bestMove: "e2e4", playedLine: ["g1f3", "d7d5"], bestLine: ["e2e4", "c7c5"], family: "kia", classification: "good" };
  assert.equal(positionalLesson({ ...input, beforeFen: "not a FEN" }), undefined);
  assert.equal(positionalLesson({ ...input, playedLine: [...input.playedLine, "f3f5"] }), undefined);
  assert.equal(positionalLesson({ ...input, bestLine: ["d2d4", "d7d5"] }), undefined);
  assert.equal(positionalLesson({ ...input, playedLine: [] }), undefined);
});

test("evidence always names a real ply on its branch and omits missing responses", () => {
  const result = lesson(new Chess().fen(), ["Nf3"], ["e4"], { classification: "good" })!;
  assert.equal(result.opponentReply, undefined);
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every((fact) => fact.ply === 1 && fact.kind === "position"));
});

test("a g-pawn capture on f5 is not misidentified as the thematic f-pawn break", () => {
  const before = "rnbq1rk1/ppp2pbp/3p1np1/3PpB2/2P1P3/2N2N2/PP3PPP/R2QKB1R b KQ - 0 9";
  const result = lesson(before, ["gxf5"], undefined, { family: "kid" });
  assert.doesNotMatch(JSON.stringify(result) ?? "", /advances the f-pawn|Time the King's Indian pawn break/);
});

test("en passant fallback names the captured pawn's actual square", () => {
  const before = "4k3/8/8/1Pp5/8/8/8/1N2K3 w - c6 0 1";
  const result = lesson(before, ["bxc6", "Kf7"], ["Nc3", "Kf7"], { classification: "good" })!;
  assert.match(result.yourMove, /captures the pawn on c5/);
  assert.doesNotMatch(result.yourMove, /pawn on c6/);
});

test("central captures explain which pawn is removed and retain the shown recapture", () => {
  const result = lesson(position(["e4", "d5"]), ["Nc3", "d4"], ["exd5", "Qxd5"], { classification: "inaccuracy" })!;
  assert.match(result.alternative!, /removes the opposing pawn from d5/);
  assert.match(result.alternative!, /Qxd5 captures the pawn on d5/);
  assert.match(result.takeaway, /opponent's recaptures/);
});
