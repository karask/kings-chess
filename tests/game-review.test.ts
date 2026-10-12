import assert from "node:assert/strict";
import test from "node:test";

import {
  GameReviewError,
  parseAndReviewPgn,
  parseImportedGames,
  reviewImportedGame,
} from "../lib/game-review";

const IMPORTED_AT = "2026-08-28T08:00:00.000Z";
const REVIEWED_AT = "2026-08-28T08:05:00.000Z";

const annotatedMultiGamePgn = `[Event "Annotated"]
[White "Alice"]
[Black "Learner"]
[Result "*"]

1. e4 {King pawn} d6 $1 (1... e5 {Open option} 2. Nf3 (2. f4!? exf4) Nc6)
2. d4 Nf6 3. Nc3 g6 4. f4 c6 *

[Event "Second"]
[White "Learner"]
[Black "Bob"]
[Result "1/2-1/2"]

1. Nf3 d5 2. g3 Nf6 1/2-1/2`;

test("parses multiple annotated games and keeps stable main-line records", () => {
  const first = parseImportedGames(annotatedMultiGamePgn, {
    importedAt: IMPORTED_AT,
    learnerName: "learner",
  });
  const second = parseImportedGames(annotatedMultiGamePgn, {
    importedAt: "2026-08-29T08:00:00.000Z",
    learnerName: "LEARNER",
  });

  assert.equal(first.length, 2);
  assert.deepEqual(first.map(({ importedGame }) => importedGame.learnerColor), ["b", "w"]);
  assert.deepEqual(first.map(({ summary }) => summary.totalPlies), [8, 4]);
  assert.match(first[0].importedGame.pgn, /Open option/);
  assert.doesNotMatch(first[0].importedGame.pgn, /\[Event "Second"\]/);
  assert.match(first[1].importedGame.pgn, /\[Event "Second"\]/);

  assert.deepEqual(
    first.map(({ importedGame }) => importedGame.id),
    second.map(({ importedGame }) => importedGame.id),
  );
  assert.deepEqual(
    first.map(({ moves }) => moves.map(({ id }) => id)),
    second.map(({ moves }) => moves.map(({ id }) => id)),
  );

  assert.deepEqual(first[0].moves[0].comments, ["King pawn"]);
  assert.deepEqual(first[0].moves[1].nags, ["$1"]);
  assert.equal(first[0].moves[1].variationCount, 1);
  assert.equal(first[0].moves[1].variationPlyCount, 5);
  assert.equal(first[0].moves[1].variationDepth, 2);
  assert.deepEqual(first[0].moves.map(({ san }) => san), [
    "e4", "d6", "d4", "Nf6", "Nc3", "g6", "f4", "c6",
  ]);
});

test("reports canonical repertoire coverage and the first learner departure", () => {
  const game = parseImportedGames(annotatedMultiGamePgn, {
    importedAt: IMPORTED_AT,
    learnerName: "Learner",
  })[0];
  const review = reviewImportedGame(game, { generatedAt: REVIEWED_AT });

  assert.deepEqual(review.coverage.matchedPromptIds, [
    "recall-pirc-austrian-develop",
  ]);
  assert.equal(review.coverage.learnerDecisionCount, 1);
  assert.equal(review.coverage.acceptedDecisionCount, 0);
  assert.equal(review.coverage.decisionAccuracyPercent, 0);
  assert.equal(review.coverage.firstDeparture?.ply, 8);
  assert.equal(review.coverage.firstDeparture?.playedMove, "c7c6");
  assert.deepEqual(review.coverage.firstDeparture?.acceptedMoves, ["f8g7"]);
  assert.deepEqual(review.result.firstDeparture, {
    ply: 8,
    fen: game.moves[7].beforeFen,
    playedMove: "c7c6",
  });
  assert.equal(review.candidates[0].classification, "opening");
  assert.equal(review.candidates[0].ply, 8);
});

test("accepts the union of authored moves at a transposed canonical position", () => {
  const review = parseAndReviewPgn(
    `[White "White"]
[Black "Learner"]

1. d4 Nf6 2. Nf3 g6 3. g3 Bg7 4. Bg2 O-O 5. O-O d6 6. c4 e5 *`,
    {
      importedAt: IMPORTED_AT,
      generatedAt: REVIEWED_AT,
      learnerColor: "b",
    },
  )[0];

  assert.deepEqual(review.coverage.matchedPromptIds, [
    "recall-kid-fianchetto-c5",
    "recall-kid-reti-transpose",
  ]);
  assert.deepEqual(review.coverage.matches[0].acceptedMoves, ["c7c5", "e7e5"]);
  assert.equal(review.coverage.matches[0].accepted, true);
  assert.equal(review.coverage.decisionAccuracyPercent, 100);
  assert.equal(review.coverage.firstDeparture, undefined);
});

test("nominates no more than three deterministic learner decisions across phases", () => {
  const immortalGame = `[White "Anderssen"]
[Black "Kieseritzky"]
[Result "1-0"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6
6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6
11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6
16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+
20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`;
  const options = {
    importedAt: IMPORTED_AT,
    generatedAt: REVIEWED_AT,
    learnerColor: "b" as const,
  };
  const first = parseAndReviewPgn(immortalGame, options)[0];
  const second = parseAndReviewPgn(immortalGame, options)[0];

  assert.deepEqual(first.candidates, second.candidates);
  assert.equal(first.candidates.length, 3);
  assert.deepEqual(
    first.candidates.map(({ classification }) => classification),
    ["opening", "strategy", "tactic"],
  );
  assert.ok(first.candidates.every((candidate) => (
    first.game.moves[candidate.ply - 1].color === "b"
  )));
  assert.deepEqual(
    first.result.criticalMoments.map(({ id, ply, classification }) => ({
      id,
      ply,
      classification,
    })),
    first.candidates.map(({ id, ply, classification }) => ({
      id,
      ply,
      classification,
    })),
  );
});

test("recognizes a custom-FEN endgame without inventing an opening moment", () => {
  const review = parseAndReviewPgn(
    `[SetUp "1"]
[FEN "8/8/8/4k3/8/4K3/4P3/8 w - - 0 1"]

1. Kd3 Kd5 2. e4+ Ke5 3. Ke3 *`,
    {
      importedAt: IMPORTED_AT,
      generatedAt: REVIEWED_AT,
      learnerColor: "w",
    },
  )[0];

  assert.ok(review.candidates.some(({ classification }) => classification === "endgame"));
  assert.ok(review.candidates.every(({ classification }) => classification !== "opening"));
});

test("rejects empty, syntactically malformed, illegal, and header-only games clearly", () => {
  assert.throws(
    () => parseImportedGames("   ", { importedAt: IMPORTED_AT }),
    (error: unknown) => error instanceof GameReviewError
      && error.message === "The PGN import is empty.",
  );
  assert.throws(
    () => parseImportedGames("1. e4 e5 2. Nope *", { importedAt: IMPORTED_AT }),
    (error: unknown) => error instanceof GameReviewError
      && /line 1, column \d+/.test(error.message)
      && /Could not parse PGN/.test(error.message),
  );
  assert.throws(
    () => parseImportedGames("1. e4 e5 2. Bh6 *", { importedAt: IMPORTED_AT }),
    (error: unknown) => error instanceof GameReviewError
      && /illegal main-line move "Bh6" at ply 3/.test(error.message),
  );
  assert.throws(
    () => parseImportedGames(`[Event "No moves"]\n\n*`, { importedAt: IMPORTED_AT }),
    (error: unknown) => error instanceof GameReviewError
      && /contains no main-line moves/.test(error.message),
  );
  assert.throws(
    () => parseImportedGames(
      `[SetUp "1"]\n[FEN "not a fen"]\n\n1. e4 *`,
      { importedAt: IMPORTED_AT },
    ),
    (error: unknown) => error instanceof GameReviewError
      && /invalid FEN header/.test(error.message),
  );
});

test("requires an identified learner before nominating learner decisions", () => {
  const game = parseImportedGames("1. e4 e5 *", { importedAt: IMPORTED_AT })[0];
  assert.throws(
    () => reviewImportedGame(game, { generatedAt: REVIEWED_AT }),
    (error: unknown) => error instanceof GameReviewError
      && /Learner color is required/.test(error.message),
  );
});
