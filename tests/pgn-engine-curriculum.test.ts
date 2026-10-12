import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import { canonicalFen, isLegalUciMove } from "../lib/chess";
import {
  openingModules,
  openingRecallPrompts,
  type OpeningRecallPrompt,
} from "../lib/curriculum";
import { parseEngineInfoLine } from "../lib/engine";
import {
  getRepertoireMoves,
  parseRepertoirePgn,
  walkRepertoireLine,
} from "../lib/pgn";

test("repertoire PGN preserves one copy of comments, NAGs, and RAV edges", () => {
  const repertoire = parseRepertoirePgn(`[Event "RAV fixture"]

1. Nf3 {Main knight} d5 $1 (1... Nf6 {Indian option} 2. g3 g6) 2. g3 {Fianchetto} *`);
  const board = new Chess();
  const rootMove = getRepertoireMoves(repertoire, board.fen()).find(
    ({ uci }) => uci === "g1f3",
  );

  assert.deepEqual(rootMove?.comments, ["Main knight"]);
  assert.equal(rootMove?.mainline, true);

  board.move("Nf3");
  const blackReplies = getRepertoireMoves(repertoire, board.fen());
  const mainline = blackReplies.find(({ uci }) => uci === "d7d5");
  const variation = blackReplies.find(({ uci }) => uci === "g8f6");

  assert.deepEqual(mainline?.nags, ["$1"]);
  assert.equal(mainline?.mainline, true);
  assert.deepEqual(variation?.comments, ["Indian option"]);
  assert.equal(variation?.mainline, false);

  const walkedVariation = walkRepertoireLine(
    repertoire,
    new Chess().fen(),
    ["Nf3", "Nf6", "g3", "g6"],
  );
  assert.equal(walkedVariation.matched, true);
  assert.deepEqual(
    walkedVariation.matchedMoves.map(({ mainline: isMainline }) => isMainline),
    [true, false, false, false],
  );
});

test("different PGN move orders merge into one transposition node", () => {
  const repertoire = parseRepertoirePgn(`[Event "Reti first"]

1. Nf3 d5 2. g3 Nf6 *

[Event "Fianchetto first"]

1. g3 d5 2. Nf3 Nf6 *`);
  const board = new Chess();
  board.move("Nf3");
  board.move("d5");
  board.move("g3");

  const mergedMoves = getRepertoireMoves(repertoire, board.fen());
  assert.equal(mergedMoves.length, 1);
  assert.equal(mergedMoves[0].uci, "g8f6");
  assert.deepEqual(mergedMoves[0].gameIndexes, [0, 1]);
  assert.equal(repertoire.rootKeys.length, 1);

  const alternateOrder = walkRepertoireLine(
    repertoire,
    new Chess().fen(),
    ["g3", "d5", "Nf3", "Nf6"],
  );
  assert.equal(alternateOrder.matched, true);
  assert.equal(alternateOrder.finalKey, mergedMoves[0].toKey);
});

test("engine info parsing retains MultiPV, signed scores, bounds, and metrics", () => {
  assert.deepEqual(
    parseEngineInfoLine(
      "info depth 18 seldepth 28 multipv 2 score cp -37 upperbound nodes 123456 nps 99999 time 123 pv e7e5 g1f3",
    ),
    {
      multipv: 2,
      depth: 18,
      selectiveDepth: 28,
      score: { type: "cp", value: -37, bound: "upper" },
      nodes: 123_456,
      nps: 99_999,
      timeMs: 123,
      pv: ["e7e5", "g1f3"],
    },
  );

  assert.deepEqual(
    parseEngineInfoLine(
      "info depth 22 score mate -3 lowerbound pv h7h8q",
    ),
    {
      multipv: 1,
      depth: 22,
      score: { type: "mate", value: -3, bound: "lower" },
      pv: ["h7h8q"],
    },
  );
});

test("engine info parsing ignores chatter and incomplete depth records", () => {
  assert.equal(parseEngineInfoLine("bestmove e2e4 ponder e7e5"), null);
  assert.equal(parseEngineInfoLine("info string NNUE evaluation enabled"), null);
  assert.equal(parseEngineInfoLine("info score cp 20 pv e2e4"), null);
  assert.equal(parseEngineInfoLine("info depth nope score cp 20"), null);
  assert.deepEqual(parseEngineInfoLine(" info depth 10 currmove e2e4 "), {
    multipv: 1,
    depth: 10,
    pv: [],
  });
});

test("every curriculum prompt has a valid FEN and legal accepted moves", () => {
  const prompts: readonly OpeningRecallPrompt[] = openingRecallPrompts;
  const failures: string[] = [];
  const seenPromptIds = new Set<string>();

  for (const prompt of prompts) {
    if (seenPromptIds.has(prompt.id)) failures.push(`${prompt.id}: duplicate id`);
    seenPromptIds.add(prompt.id);

    let fen: string;
    try {
      fen = canonicalFen(prompt.fen);
    } catch (error) {
      failures.push(
        `${prompt.id}: invalid FEN (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }

    const branchExists = openingModules[prompt.family].branches.some(
      ({ id }) => id === prompt.branchId,
    );
    if (!branchExists) failures.push(`${prompt.id}: unknown branch ${prompt.branchId}`);

    const choiceIds = prompt.choices.map(({ id }) => id);
    if (new Set(choiceIds).size !== choiceIds.length) {
      failures.push(`${prompt.id}: duplicate choice id`);
    }
    if (!choiceIds.includes(prompt.correctChoiceId)) {
      failures.push(`${prompt.id}: correct choice is absent`);
    }

    for (const move of prompt.acceptedMoves ?? []) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
        failures.push(`${prompt.id}: accepted move is not UCI (${move})`);
      } else if (!isLegalUciMove(fen, move)) {
        failures.push(`${prompt.id}: accepted move is illegal (${move})`);
      }
    }

    if ((prompt.acceptedMoves?.length ?? 0) > 0) {
      const expectedTurn = prompt.orientation === "white" ? "w" : "b";
      if (fen.split(" ")[1] !== expectedTurn) {
        failures.push(`${prompt.id}: accepted move belongs to the wrong side`);
      }
    }
  }

  assert.deepEqual(failures, []);
  assert.equal(seenPromptIds.size, prompts.length);
});
