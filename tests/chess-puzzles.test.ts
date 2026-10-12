import assert from "node:assert/strict";
import test from "node:test";

import {
  ChessDataError,
  applyUciMove,
  canonicalEpd,
  canonicalFen,
  createPuzzleSession,
  isLegalUciMove,
  legalUciMoves,
  parseLichessPuzzleCsvLine,
  parseUciMove,
  positionKeyAfterMoves,
  prepareLichessPuzzle,
  submitPuzzleMove,
} from "../lib/chess";
import type { LichessPuzzle } from "../lib/types";

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function puzzle(fen: string, moves: string[]): LichessPuzzle {
  return {
    id: "fixture",
    fen,
    moves,
    rating: 1_200,
    ratingDeviation: 75,
    popularity: 90,
    plays: 100,
    themes: ["fixture"],
    gameUrl: "https://lichess.org/fixture",
    openingTags: [],
  };
}

test("canonical chess keys ignore clocks but preserve position rights", () => {
  const fourField =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
  const differentClocks = `${fourField} 48 91`;
  const noCastling =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
  const blackToMove =
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

  assert.equal(canonicalEpd(fourField), canonicalEpd(differentClocks));
  assert.notEqual(canonicalEpd(fourField), canonicalEpd(noCastling));
  assert.notEqual(canonicalEpd(fourField), canonicalEpd(blackToMove));
  assert.match(canonicalFen(fourField), / 0 1$/);
});

test("canonical FEN keeps only a legally usable en-passant square", () => {
  const phantomEnPassant =
    "8/8/8/3p4/8/8/8/K6k w - d6 0 1";
  const legalEnPassant =
    "8/8/8/3pP3/8/8/8/K6k w - d6 0 1";

  assert.equal(canonicalFen(phantomEnPassant).split(" ")[3], "-");
  assert.equal(canonicalFen(legalEnPassant).split(" ")[3], "d6");
  assert.equal(legalUciMoves(legalEnPassant).includes("e5d6"), true);
});

test("UCI helpers normalize promotions and reject malformed or illegal moves", () => {
  assert.deepEqual(parseUciMove(" A7A8N "), {
    from: "a7",
    to: "a8",
    promotion: "n",
  });
  assert.equal(
    applyUciMove("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8n")
      .san,
    "a8=N",
  );
  assert.equal(isLegalUciMove(START_FEN, "e2e5"), false);
  assert.throws(() => parseUciMove("e2-e4"), ChessDataError);
});

test("transposed move orders produce the same canonical position key", () => {
  const retiFirst = positionKeyAfterMoves(START_FEN, [
    "g1f3",
    "d7d5",
    "g2g3",
    "g8f6",
  ]);
  const fianchettoFirst = positionKeyAfterMoves(START_FEN, [
    "g2g3",
    "d7d5",
    "g1f3",
    "g8f6",
  ]);

  assert.equal(retiFirst, fianchettoFirst);
});

test("Lichess CSV parsing respects quoted fields and first-move semantics", () => {
  const sourceFen = "7k/p4K2/6Q1/8/8/8/8/8 b - - 0 1";
  const parsed = parseLichessPuzzleCsvLine(
    `mate-fixture,"${sourceFen}","a7a6 g6g7",1200,75,90,100,"mate mateIn1","https://lichess.org/game,variant","Queen_Endgame",2026-08-02\r`,
  );
  const prepared = prepareLichessPuzzle(parsed);

  assert.equal(parsed.gameUrl, "https://lichess.org/game,variant");
  assert.deepEqual(parsed.openingTags, ["Queen_Endgame"]);
  assert.equal(prepared.sourceFen, canonicalFen(sourceFen));
  assert.equal(prepared.initialMove, "a7a6");
  assert.equal(prepared.initialMoveSan, "a6");
  assert.equal(
    prepared.startFen,
    applyUciMove(sourceFen, "a7a6").afterFen,
  );
  assert.equal(prepared.playerColor, "w");
  assert.deepEqual(prepared.solution, ["g6g7"]);
});

test("Lichess preparation rejects a line that does not end on a learner move", () => {
  assert.throws(
    () =>
      prepareLichessPuzzle(
        puzzle(START_FEN, ["e2e4", "e7e5", "g1f3"]),
      ),
    /even number of post-setup plies/,
  );
});

test("puzzle sessions require the full published line and auto-play one reply", () => {
  const prepared = prepareLichessPuzzle(
    puzzle(
      "rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P1b1/2N5/PPPP1PPP/R1BQK2R b KQkq - 0 5",
      ["g4d1", "c4f7", "e8e7", "c3d5"],
    ),
  );
  const initial = createPuzzleSession(prepared);
  const wrong = submitPuzzleMove(initial, "c4b3");

  assert.equal(wrong.verdict, "incorrect");
  assert.equal(wrong.session.cursor, 0);
  assert.equal(wrong.session.mistakes, 1);

  const first = submitPuzzleMove(initial, "c4f7");
  assert.equal(first.verdict, "correct");
  assert.equal(first.complete, false);
  assert.equal(first.opponentMove, "e8e7");
  assert.deepEqual(first.session.playedMoves, ["c4f7", "e8e7"]);
  assert.equal(first.session.cursor, 2);

  const final = submitPuzzleMove(first.session, "c3d5");
  assert.equal(final.verdict, "correct");
  assert.equal(final.complete, true);
  assert.equal(final.session.status, "solved");
  assert.equal(submitPuzzleMove(final.session, "c3d5").verdict, "already-solved");
});

test("an alternate final mate is accepted only when the published move also mates", () => {
  const sourceFen = "7k/p4K2/6Q1/8/8/8/8/8 b - - 0 1";
  const publishedMate = createPuzzleSession(
    prepareLichessPuzzle(puzzle(sourceFen, ["a7a6", "g6g7"])),
  );
  const publishedNonMate = createPuzzleSession(
    prepareLichessPuzzle(puzzle(sourceFen, ["a7a6", "g6a6"])),
  );

  const accepted = submitPuzzleMove(publishedMate, "g6g8");
  assert.equal(accepted.verdict, "alternate-mate");
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.complete, true);

  const rejected = submitPuzzleMove(publishedNonMate, "g6g8");
  assert.equal(rejected.verdict, "incorrect");
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.complete, false);
});
