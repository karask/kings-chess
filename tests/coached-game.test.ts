import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Chess } from "chess.js";

import { canonicalEpd, moveToUci, parseUciMove } from "../lib/chess";
import type { MoveAssessment } from "../lib/coaching";
import {
  COACHED_GAME_SETTING,
  COACHED_SCENARIOS,
  CoachedGameValidationError,
  appendGameMove,
  canTakeBack,
  createCoachedGame,
  gameBoard,
  gamePgn,
  gameResult,
  loadCoachedGame,
  opponentBookMove,
  saveCoachedGame,
  takeBackTurn,
  validateCoachedGame,
  type CoachedGame,
} from "../lib/coached-game";
import { openingRecallPrompts } from "../lib/curriculum";
import { clearLocalData, closeChessTrainerDb, exportBackup, getChessTrainerDb, putSetting, restoreBackup, reviewCard } from "../lib/storage";

before(async () => { await clearLocalData(); });
after(async () => { await clearLocalData(); closeChessTrainerDb(); });

function fresh(overrides: Partial<Parameters<typeof createCoachedGame>[0]> = {}): CoachedGame {
  return createCoachedGame({ family: "kia", scenarioId: "kia-e6", startMode: "start", skillLevel: 5, coaching: "critical", ...overrides });
}

function withSans(game: CoachedGame, san: string): CoachedGame {
  for (const token of san.split(" ")) {
    const board = gameBoard(game);
    game = appendGameMove(game, moveToUci(board.move(token)));
  }
  return game;
}

function assessed(): CoachedGame {
  let game = fresh();
  const beforeFen = game.initialFen;
  game = appendGameMove(game, "g1f3");
  const assessment: MoveAssessment = {
    playedMove: "g1f3", playedSan: "Nf3", bestMove: "g1f3", bestSan: "Nf3",
    classification: "best", title: "Best — develops a knight", explanation: "Develops a knight and controls the centre.",
    confidence: "limited", bestLine: ["g1f3", "d7d5"], playedLine: ["g1f3", "d7d5"],
    beforeFen, lossCp: 0, bestScore: { type: "cp", value: 22 }, playedScore: { type: "cp", value: 22, bound: "lower" },
    evidence: [{ kind: "authored", text: "A flexible first move for the KIA.", squares: ["f3"] }],
  };
  return { ...game, assessments: [{ ply: 1, assessment }], pausedAtPly: 1, reviewSavedPlies: [1] };
}

function addSimpleAssessments(game: CoachedGame): CoachedGame {
  const board = new Chess(game.initialFen);
  const assessments: CoachedGame["assessments"] = [];
  game.moves.forEach((move, index) => {
    const beforeFen = board.fen();
    const learnerMove = board.turn() === game.learnerColor;
    const played = board.move(parseUciMove(move));
    if (learnerMove) {
      assessments.push({
        ply: index + 1,
        assessment: {
          playedMove: move, playedSan: played.san, bestMove: move, bestSan: played.san,
          classification: "best", confidence: "limited", title: "Best", explanation: "Test assessment.",
          beforeFen, bestLine: [move], playedLine: [move], evidence: [],
        },
      });
    }
  });
  return { ...game, assessments };
}

test("narrated tactical evidence survives local saving and lossless backup restore", async () => {
  const game = assessed();
  game.assessments[0].assessment.evidence = [{
    kind: "defense", text: "The knight now guards e5.", squares: ["f3", "e5"], line: "played", ply: 1,
    steps: [{ ply: 1, text: "Nf3 adds a defender to e5.", squares: ["f3", "e5"] }],
  }];
  await saveCoachedGame(game);
  const backup = await exportBackup();
  await clearLocalData();
  await restoreBackup(backup);
  assert.deepEqual((await loadCoachedGame())?.assessments, game.assessments);
});

test("saved narration rejects invalid branches, future steps, squares, and unordered steps", () => {
  const base = { kind: "defense", text: "A checked relationship.", squares: ["f3"], line: "played", ply: 1, steps: [{ ply: 1, text: "Develops.", squares: ["f3"] }] };
  for (const changes of [
    { line: "unknown" }, { line: undefined }, { ply: 3 }, { ply: 0 },
    { steps: [{ ply: 1, text: "Develops.", squares: ["z9"] }] },
    { steps: [{ ply: 2, text: "Reply.", squares: [] }, { ply: 1, text: "Develops.", squares: [] }] },
  ]) {
    const game = assessed();
    (game.assessments[0].assessment as unknown as { evidence: unknown[] }).evidence = [{ ...base, ...changes }];
    assert.throws(() => validateCoachedGame(game), CoachedGameValidationError);
  }
});

test("all nine authored scenarios are legal, have learner-to-move tabiyas, and match curriculum positions", () => {
  assert.equal(COACHED_SCENARIOS.length, 9);
  assert.equal(new Set(COACHED_SCENARIOS.map((scenario) => scenario.id)).size, 9);
  for (const family of ["pirc", "kid", "kia"]) assert.equal(COACHED_SCENARIOS.filter((item) => item.family === family).length, 3);
  for (const scenario of COACHED_SCENARIOS) {
    const board = new Chess();
    const positions = [board.fen()];
    for (const move of scenario.bookMoves) {
      board.move(parseUciMove(move));
      positions.push(board.fen());
    }
    assert.ok(positions.includes(scenario.tabiyaFen), scenario.id);
    assert.equal(new Chess(scenario.tabiyaFen).turn(), scenario.family === "kia" ? "w" : "b");
    assert.ok(openingRecallPrompts.some((prompt) => prompt.family === scenario.family && canonicalEpd(prompt.fen) === canonicalEpd(scenario.tabiyaFen)), scenario.id);
    const game = fresh({ family: scenario.family, scenarioId: scenario.id, startMode: "tabiya" });
    assert.equal(gameBoard(game).fen(), scenario.tabiyaFen);
    assert.equal(game.moves.length, 0);
    assert.equal(opponentBookMove(game), null);
  }
});

test("book replies follow only the selected line and hand off at its end", () => {
  for (const scenario of COACHED_SCENARIOS) {
    let game = fresh({ family: scenario.family, scenarioId: scenario.id });
    for (const move of scenario.bookMoves) {
      const board = gameBoard(game);
      assert.equal(opponentBookMove(game), board.turn() === game.learnerColor ? null : move);
      game = appendGameMove(game, move);
    }
    assert.equal(opponentBookMove(game), null);
  }
});

test("deviations hand off immediately without forcing an unrelated authored move", () => {
  let game = fresh({ family: "pirc", scenarioId: "pirc-austrian" });
  assert.equal(opponentBookMove(game), "e2e4");
  game = withSans(game, "e4 c5");
  assert.equal(opponentBookMove(game), null);
  game = withSans(game, "Nf3");
  assert.equal(opponentBookMove(game), null);
});

test("append preserves the original record and clears a fulfilled coaching pause", () => {
  const original = assessed();
  const next = appendGameMove(original, "d7d5");
  assert.deepEqual(original.moves, ["g1f3"]);
  assert.equal(original.pausedAtPly, 1);
  assert.equal(next.pausedAtPly, undefined);
  assert.deepEqual(next.moves, ["g1f3", "d7d5"]);
  assert.equal(next.assessments.length, 1);
  assert.throws(() => appendGameMove(next, "a1a8"), CoachedGameValidationError);
});

test("takeback is unavailable until the learner has made a move", () => {
  for (const startMode of ["start", "tabiya"] as const) {
    for (const scenario of COACHED_SCENARIOS) {
      const game = fresh({ family: scenario.family, scenarioId: scenario.id, startMode });
      assert.equal(canTakeBack(game), false);
      assert.equal(takeBackTurn(game), game);
    }
  }
  const waitingForBlack = withSans(fresh({ family: "pirc", scenarioId: "pirc-austrian" }), "e4");
  assert.equal(canTakeBack(waitingForBlack), false);
  assert.equal(takeBackTurn(waitingForBlack), waitingForBlack);
  const resignedWithoutMove = { ...fresh(), resigned: true };
  assert.equal(takeBackTurn(resignedWithoutMove), resignedWithoutMove);
});

test("White can undo a pending move or a move followed by the computer reply", () => {
  for (const line of ["Nf3", "Nf3 d5"]) {
    const original = withSans(fresh(), line);
    const snapshot = structuredClone(original);
    const takenBack = takeBackTurn(original);
    assert.equal(canTakeBack(original), true);
    assert.deepEqual(original, snapshot);
    assert.deepEqual(takenBack.moves, []);
    assert.equal(gameBoard(takenBack).turn(), "w");
    assert.equal(gameBoard(takenBack).fen(), original.initialFen);
    assert.notEqual(takenBack.id, original.id);
    assert.equal(takenBack.createdAt, original.createdAt);
    validateCoachedGame(takenBack);
  }
});

test("Black takeback keeps the computer opening move and always returns Black to move", () => {
  for (const line of ["e4 d6", "e4 d6 d4"]) {
    const original = withSans(fresh({ family: "pirc", scenarioId: "pirc-austrian" }), line);
    const takenBack = takeBackTurn(original);
    assert.deepEqual(takenBack.moves, ["e2e4"]);
    assert.equal(gameBoard(takenBack).turn(), "b");
    assert.equal(canTakeBack(takenBack), false);
    validateCoachedGame(takenBack);
  }
});

test("takeback works from every White and Black tabiya root without undoing the authored setup", () => {
  for (const scenario of COACHED_SCENARIOS) {
    const root = fresh({ family: scenario.family, scenarioId: scenario.id, startMode: "tabiya" });
    const book = new Chess();
    let tabiyaIndex = -1;
    scenario.bookMoves.forEach((move, index) => {
      book.move(parseUciMove(move));
      if (book.fen() === root.initialFen) tabiyaIndex = index + 1;
    });
    assert.ok(tabiyaIndex >= 0);
    const learnerMove = appendGameMove(root, scenario.bookMoves[tabiyaIndex]);
    const withReply = appendGameMove(learnerMove, scenario.bookMoves[tabiyaIndex + 1]);
    for (const original of [learnerMove, withReply]) {
      const takenBack = takeBackTurn(original);
      assert.deepEqual(takenBack.moves, []);
      assert.equal(gameBoard(takenBack).fen(), root.initialFen);
      assert.equal(gameBoard(takenBack).turn(), root.learnerColor);
      validateCoachedGame(takenBack);
    }
  }
});

test("takeback retains earlier feedback but drops discarded assessments, pauses and skip markers", () => {
  const original: CoachedGame = {
    ...addSimpleAssessments(withSans(fresh(), "Nf3 d5 g3 c5 Bg2")),
    pausedAtPly: 5, reviewSavedPlies: [1, 5], skippedAssessmentPlies: [3, 5],
  };
  const takenBack = takeBackTurn(original);
  assert.deepEqual(takenBack.moves, original.moves.slice(0, 4));
  assert.deepEqual(takenBack.assessments, original.assessments.slice(0, 2));
  assert.deepEqual(takenBack.reviewSavedPlies, [1]);
  assert.deepEqual(takenBack.skippedAssessmentPlies, [3]);
  assert.equal(takenBack.pausedAtPly, undefined);
  assert.equal(gameBoard(takenBack).turn(), "w");
  validateCoachedGame(takenBack);
  const another = takeBackTurn(takenBack);
  assert.deepEqual(another.moves, original.moves.slice(0, 2));
  assert.deepEqual(another.assessments, original.assessments.slice(0, 1));
  assert.deepEqual(another.skippedAssessmentPlies, []);
  assert.deepEqual(another.reviewSavedPlies, [1]);
  assert.notEqual(another.id, takenBack.id);
  validateCoachedGame(another);
});

test("checkmate, repetition and resignation can be taken back to a live learner turn", () => {
  for (const options of [{}, { family: "pirc" as const, scenarioId: "pirc-austrian" }]) {
    const mate = withSans(fresh(options), "f3 e5 g4 Qh4#");
    assert.ok(gameResult(mate));
    const takenBack = takeBackTurn(mate);
    assert.equal(gameResult(takenBack), null);
    assert.equal(gameBoard(takenBack).turn(), mate.learnerColor);
    assert.equal(takenBack.moves.length, mate.learnerColor === "w" ? 2 : 3);
    validateCoachedGame(takenBack);
  }
  const drawn = withSans(fresh(), "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8");
  const undoneDraw = takeBackTurn(drawn);
  assert.equal(gameResult(undoneDraw), null);
  assert.equal(gameBoard(undoneDraw).isThreefoldRepetition(), false);
  assert.equal(undoneDraw.moves.length, 6);
  const resigned = { ...withSans(fresh(), "Nf3 d5"), resigned: true };
  const undoneResignation = takeBackTurn(resigned);
  assert.equal(undoneResignation.resigned, undefined);
  assert.equal(gameResult(undoneResignation), null);
  assert.equal(gameBoard(undoneResignation).turn(), "w");
});

test("takeback restores castling, en-passant and promotion positions using full history", () => {
  const beforeCastle = withSans(fresh(), "e4 e5 Nf3 Nc6 Bc4 Nf6");
  const castle = withSans(beforeCastle, "O-O");
  const undoCastle = takeBackTurn(castle);
  assert.equal(gameBoard(undoCastle).fen(), gameBoard(beforeCastle).fen());
  assert.ok(gameBoard(undoCastle).moves().includes("O-O"));
  const beforeEp = withSans(fresh(), "e4 a6 e5 d5");
  const undoEp = takeBackTurn(withSans(beforeEp, "exd6"));
  assert.equal(gameBoard(undoEp).fen(), gameBoard(beforeEp).fen());
  assert.ok(gameBoard(undoEp).moves().includes("exd6"));
  const beforePromotion = { ...fresh(), initialFen: "7k/P7/8/8/8/8/8/7K w - - 0 1" };
  const undoPromotion = takeBackTurn(appendGameMove(beforePromotion, "a7a8n"));
  assert.equal(gameBoard(undoPromotion).fen(), beforePromotion.initialFen);
});

test("full replay retains threefold repetition and disallows play after the draw", () => {
  const game = withSans(fresh(), "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8");
  assert.equal(gameBoard(game).isThreefoldRepetition(), true);
  assert.equal(new Chess(gameBoard(game).fen()).isThreefoldRepetition(), false);
  assert.equal(gameResult(game), "Draw by threefold repetition");
  assert.throws(() => appendGameMove(game, "g1f3"), /already ended/);
  assert.throws(() => validateCoachedGame({ ...game, moves: [...game.moves, "g1f3"] }), /after the game has ended/);
  assert.match(gamePgn(game), /\[Result "1\/2-1\/2"\]/);
});

test("full replay retains castling and en-passant rules", () => {
  const castled = withSans(fresh(), "e4 e5 Nf3 Nc6 Bc4 Nf6 O-O");
  assert.deepEqual(gameBoard(castled).get("g1"), { type: "k", color: "w" });
  assert.deepEqual(gameBoard(castled).get("f1"), { type: "r", color: "w" });
  assert.equal(gameBoard(castled).history().at(-1), "O-O");
  const ep = withSans(fresh(), "e4 a6 e5 d5 exd6");
  assert.equal(gameBoard(ep).get("d5"), undefined);
  assert.deepEqual(gameBoard(ep).get("d6"), { type: "p", color: "w" });
  assert.equal(validateCoachedGame(ep).moves.at(-1), "e5d6");
});

test("board helpers support promotion choices without discarding history", () => {
  const root = { ...fresh(), initialFen: "7k/P7/8/8/8/8/8/7K w - - 0 1" };
  const promoted = appendGameMove(root, "a7a8r");
  assert.deepEqual(gameBoard(promoted).get("a8"), { type: "r", color: "w" });
  assert.equal(gameBoard(promoted).history()[0], "a8=R+");
  assert.throws(() => appendGameMove(root, "a7a8"), CoachedGameValidationError);
});

test("mate, resignation, stalemate, insufficient material and fifty-move draw produce clear outcomes", () => {
  const mate = withSans(fresh(), "f3 e5 g4 Qh4#");
  assert.equal(gameResult(mate), "Black wins by checkmate");
  assert.match(gamePgn(mate), /\[Result "0-1"\]/);
  assert.match(gamePgn(mate), /Qh4# 0-1$/);
  assert.equal(gameResult({ ...fresh(), resigned: true }), "Black wins by resignation");
  const blackLearner = fresh({ family: "kid", scenarioId: "kid-classical" });
  assert.equal(gameResult({ ...blackLearner, resigned: true }), "White wins by resignation");
  assert.equal(gameResult({ ...fresh(), initialFen: "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1" }), "Draw by stalemate");
  assert.equal(gameResult({ ...fresh(), initialFen: "7k/8/8/8/8/8/8/K7 w - - 0 1" }), "Draw by insufficient material");
  assert.equal(gameResult({ ...fresh(), initialFen: "7k/8/8/8/8/8/8/KR6 w - - 100 80" }), "Draw by the fifty-move rule");
});

test("PGN exports full-game and tabiya roots and can be reimported exactly", () => {
  for (const startMode of ["start", "tabiya"] as const) {
    let game = fresh({ family: "pirc", scenarioId: "pirc-austrian", startMode });
    game = withSans(game, startMode === "start" ? "e4 d6 d4 Nf6" : "Bg7 Nf3 O-O");
    const pgn = gamePgn(game);
    const imported = new Chess();
    imported.loadPgn(pgn);
    assert.equal(imported.fen(), gameBoard(game).fen());
    assert.deepEqual(imported.history(), gameBoard(game).history());
    assert.equal(pgn.includes('[SetUp "1"]'), startMode === "tabiya");
  }
});

test("validates assessments against the actual learner move, position and continuation", () => {
  const game = assessed();
  assert.deepEqual(validateCoachedGame(game), game);
  const mutate = (fields: Record<string, unknown>) => ({ ...game, assessments: [{ ply: 1, assessment: { ...game.assessments[0].assessment, ...fields } }] });
  for (const fields of [
    { playedMove: "e2e4" }, { beforeFen: new Chess().fen().replace(" w ", " b ") },
    { bestMove: "a1a8" }, { bestSan: "Nc3" }, { playedSan: "Nf3+" },
    { classification: "brilliant" }, { classification: ["best"] }, { confidence: "certain" },
    { bestLine: ["g1f3", "e7e3"] }, { playedLine: ["e2e4"] },
    { lossCp: -1 }, { bestScore: { type: "cp", value: Infinity } },
    { evidence: [{ kind: "material", text: "A claim", squares: ["z9"] }] },
  ]) assert.throws(() => validateCoachedGame(mutate(fields)), CoachedGameValidationError);
  assert.throws(() => validateCoachedGame({ ...game, assessments: [...game.assessments, game.assessments[0]] }), /move number/);
  const next = appendGameMove(game, "d7d5");
  assert.throws(() => validateCoachedGame({ ...next, pausedAtPly: 1 }), /pause/);
});

test("rejects malformed versions, roots, choices, oversized data and histories", () => {
  const game = fresh();
  const invalid: unknown[] = [null, [], "game", { ...game, schemaVersion: 2 }, { ...game, id: "../x" },
    { ...game, family: "sicilian" }, { ...game, scenarioId: "pirc-austrian" },
    { ...game, startMode: "random" }, { ...game, initialFen: "bad fen" }, { ...game, learnerColor: "b" },
    { ...game, skillLevel: 21 }, { ...game, skillLevel: 2.5 }, { ...game, coaching: "off" }, { ...game, coaching: ["critical"] },
    { ...game, createdAt: "not a date" }, { ...game, updatedAt: new Date() },
    { ...game, moves: ["Nf3"] }, { ...game, moves: ["e7e5"] }, { ...game, moves: new Array(1025).fill("g1f3") },
    { ...game, pausedAtPly: 0 }, { ...game, skippedAssessmentPlies: [1] }, { ...game, reviewSavedPlies: [1] },
    { ...game, resigned: "yes" }, { ...game, extra: "x".repeat(4097) }, { ...game, extra: () => undefined },
  ];
  for (const item of invalid) assert.throws(() => validateCoachedGame(item), CoachedGameValidationError);
  assert.throws(() => fresh({ family: "kid", scenarioId: "kia-e6" }), CoachedGameValidationError);
});

test("skipped-analysis markers are learner moves, unique and survive validation", () => {
  const game = withSans(fresh(), "Nf3 d5 g3");
  assert.deepEqual(validateCoachedGame({ ...game, skippedAssessmentPlies: [1, 3] }).skippedAssessmentPlies, [1, 3]);
  assert.throws(() => validateCoachedGame({ ...game, skippedAssessmentPlies: [2] }), /skippedAssessmentPlies/);
  assert.throws(() => validateCoachedGame({ ...game, skippedAssessmentPlies: [1, 1] }), /skippedAssessmentPlies/);
});

test("autosave survives database close and versioned backup/restore without data loss", async () => {
  await clearLocalData();
  assert.equal(await loadCoachedGame(), null);
  const game = assessed();
  await saveCoachedGame(game);
  closeChessTrainerDb();
  assert.deepEqual(await loadCoachedGame(), game);
  const backup = await exportBackup();
  await clearLocalData();
  assert.equal(await loadCoachedGame(), null);
  await restoreBackup(backup, { mode: "replace" });
  assert.deepEqual(await loadCoachedGame(), game);
  assert.equal(gameBoard((await loadCoachedGame())!).fen(), gameBoard(game).fen());
});

test("taken-back games reload and restore while old spaced reviews remain separate from the replayed branch", async () => {
  await clearLocalData();
  const original: CoachedGame = {
    ...addSimpleAssessments(withSans(fresh(), "Nf3 d5 g3 c5 Bg2")),
    reviewSavedPlies: [1, 5], skippedAssessmentPlies: [3, 5], pausedAtPly: 5,
  };
  const originalSnapshot = structuredClone(original);
  const earlierCardId = `coached:${original.id}:1`;
  const discardedCardId = `coached:${original.id}:5`;
  await reviewCard(earlierCardId, 1, { itemId: earlierCardId, kind: "custom", source: "coached-game" });
  await reviewCard(discardedCardId, 1, { itemId: discardedCardId, kind: "custom", source: "coached-game" });
  const db = getChessTrainerDb()!;
  const earlierCard = await db.reviewCards.get(earlierCardId);
  const discardedCard = await db.reviewCards.get(discardedCardId);
  const originalEvents = await db.reviewEvents.toArray();

  const takenBack = takeBackTurn(original);
  validateCoachedGame(takenBack);
  assert.deepEqual(original, originalSnapshot);
  await saveCoachedGame(takenBack);
  assert.deepEqual(await db.reviewEvents.toArray(), originalEvents);
  closeChessTrainerDb();
  assert.deepEqual(await loadCoachedGame(), takenBack);
  const backup = await exportBackup();
  await clearLocalData();
  await restoreBackup(backup, { mode: "replace" });
  assert.deepEqual(await loadCoachedGame(), takenBack);
  assert.equal(gameBoard((await loadCoachedGame())!).turn(), "w");

  const branch = addSimpleAssessments(appendGameMove(takenBack, "d2d3"));
  const branchCardId = `coached:${branch.id}:5`;
  assert.notEqual(branchCardId, discardedCardId);
  await reviewCard(branchCardId, 1, { itemId: branchCardId, kind: "custom", source: "coached-game" });
  branch.reviewSavedPlies = [...(branch.reviewSavedPlies ?? []), 5];
  await saveCoachedGame(branch);
  const restoredDb = getChessTrainerDb()!;
  assert.deepEqual(await restoredDb.reviewCards.get(earlierCardId), earlierCard);
  assert.deepEqual(await restoredDb.reviewCards.get(discardedCardId), discardedCard);
  assert.equal(await restoredDb.reviewCards.count(), 3);
  assert.equal(await restoredDb.reviewEvents.count(), 3);
  for (const event of originalEvents) {
    // Backup JSON omits optional undefined FSRS fields, without changing data.
    assert.deepEqual(JSON.parse(JSON.stringify(await restoredDb.reviewEvents.get(event.id))), JSON.parse(JSON.stringify(event)));
  }
  assert.deepEqual(await loadCoachedGame(), branch);
});

test("corrupted saved records are reported rather than silently overwritten or resumed", async () => {
  await putSetting(COACHED_GAME_SETTING, { schemaVersion: 999 });
  await assert.rejects(loadCoachedGame, CoachedGameValidationError);
  await assert.rejects(() => saveCoachedGame({ ...fresh(), moves: ["a1a8"] }), CoachedGameValidationError);
});
