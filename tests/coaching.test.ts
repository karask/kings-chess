import assert from "node:assert/strict";
import test from "node:test";

import { Chess } from "chess.js";

import {
  assessMove,
  authoredMoveContext,
  classifyMove,
  explainMove,
  openingStrategicContext,
  replayCoachingLine,
} from "../lib/coaching";
import { openingRecallPrompts } from "../lib/curriculum";
import { EngineCancelledError, type StockfishClient } from "../lib/engine";
import type { EngineAnalysis, EngineScore, EngineSearchOptions } from "../lib/types";

const START = new Chess().fen();
const cp = (value: number): EngineScore => ({ type: "cp", value });
const mate = (value: number): EngineScore => ({ type: "mate", value });

function engineResult(fen: string, line: string[], score?: EngineScore): EngineAnalysis {
  return { generation: 1, fen, perspective: new Chess(fen).turn(), bestMove: line[0] ?? null, ponderMove: line[1] ?? null, elapsedMs: 1, lines: [{ multipv: 1, depth: 14, pv: line, ...(score ? { score } : {}) }] };
}

test("coaching labels use transparent evaluation loss, not the sign of a score", () => {
  assert.deepEqual(classifyMove(cp(-350), cp(-350), true), { classification: "best", lossCp: 0 });
  assert.deepEqual(classifyMove(cp(-350), cp(-355)), { classification: "excellent", lossCp: 5 });
  assert.deepEqual(classifyMove(cp(0), cp(-15)), { classification: "excellent", lossCp: 15 });
  assert.deepEqual(classifyMove(cp(0), cp(-50)), { classification: "good", lossCp: 50 });
  assert.deepEqual(classifyMove(cp(0), cp(-100)), { classification: "inaccuracy", lossCp: 100 });
  assert.deepEqual(classifyMove(cp(0), cp(-200)), { classification: "mistake", lossCp: 200 });
  assert.deepEqual(classifyMove(cp(0), cp(-201)), { classification: "blunder", lossCp: 201 });
});

test("mate outcomes are not converted to fake centipawns or extra blunders in lost positions", () => {
  assert.deepEqual(classifyMove(mate(-8), mate(-3)), { classification: "good" });
  assert.deepEqual(classifyMove(mate(2), mate(5)), { classification: "excellent" });
  assert.deepEqual(classifyMove(cp(0), mate(-3)), { classification: "blunder" });
  assert.deepEqual(classifyMove(cp(-900), mate(-3)), { classification: "unrated" });
  assert.deepEqual(classifyMove(mate(3), cp(900)), { classification: "inaccuracy" });
  assert.deepEqual(classifyMove(mate(3), mate(-2)), { classification: "blunder" });
  assert.deepEqual(classifyMove(mate(3), mate(0)), { classification: "unrated" });
});

test("missing, bound, nonfinite, and substantially disagreeing scores remain unrated", () => {
  assert.equal(classifyMove(undefined, cp(10)).classification, "unrated");
  assert.equal(classifyMove({ ...cp(10), bound: "lower" }, cp(10)).classification, "unrated");
  assert.equal(classifyMove(cp(Number.NaN), cp(10)).classification, "unrated");
  assert.equal(classifyMove(cp(10), cp(100)).classification, "unrated");
});

test("legal replay refuses an illegal engine line rather than explaining its prefix", () => {
  const replay = replayCoachingLine(START, ["e2e4", "e7e5", "e4e6"]);
  assert.equal(replay.legal, false);
  assert.equal(replay.materialSettled, false);
  assert.deepEqual(replay.moves, []);
});

test("material evidence considers recaptures and rejects truncated exchanges", () => {
  const board = new Chess();
  board.move("e4"); board.move("d5");
  const partial = replayCoachingLine(board.fen(), ["e4d5"]);
  assert.equal(partial.materialChange, 100);
  assert.equal(partial.materialSettled, false);
  const complete = replayCoachingLine(board.fen(), ["e4d5", "d8d5", "b1c3", "d5d8"]);
  assert.equal(complete.legal, true);
  assert.equal(complete.materialChange, 0);
  assert.equal(complete.materialSettled, true);
});

const FORK_FEN = "4k3/7p/8/8/8/4n3/7P/R3K3 w Q - 0 1";
const FORK_LINE = ["h2h3", "e3c2", "e1f2", "c2a1", "h3h4", "h7h6"];
const AVOID_FORK_LINE = ["a1a2", "e3d5", "h2h3", "h7h6"];

test("explains a legal knight fork only after verifying the targets, capture, and material consequence", () => {
  const explanation = explainMove({ beforeFen: FORK_FEN, playedMove: "h2h3", bestMove: "a1a2", playedLine: FORK_LINE, bestLine: AVOID_FORK_LINE, classification: "blunder", family: "kia" });
  assert.equal(explanation.confidence, "verified");
  assert.match(explanation.title, /knight fork/);
  assert.match(explanation.explanation, /forks your king on e1 and rook on a1/);
  assert.match(explanation.explanation, /5 pawn-value points/);
  assert.deepEqual(explanation.evidence[0].squares, ["c2", "e1", "a1"]);
});

test("a short sacrifice line does not generate a claim that material is lost", () => {
  const explanation = explainMove({ beforeFen: FORK_FEN, playedMove: "h2h3", bestMove: "a1a2", playedLine: FORK_LINE.slice(0, 4), bestLine: AVOID_FORK_LINE, classification: "blunder", family: "kia" });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
  assert.match(explanation.explanation, /no concrete cause has been verified/);
});

test("good moves can explain a demonstrated material benefit rather than only bad moves", () => {
  const beforeFen = "4k3/p6p/8/8/8/8/7P/R3K3 w - - 0 1";
  const line = ["a1a7", "h7h6", "h2h3"];
  const explanation = explainMove({ beforeFen, playedMove: "a1a7", bestMove: "a1a7", playedLine: line, bestLine: line, classification: "best", family: "kia" });
  assert.equal(explanation.confidence, "verified");
  assert.match(explanation.title, /material gained/);
  assert.match(explanation.explanation, /improves by 1 pawn-value points/);
  assert.equal(explanation.evidence[0].kind, "material");
});

test("an unfinished exchange in the alternative cannot substantiate a material comparison", () => {
  const beforeFen = "4k3/p6p/8/8/8/4n3/7P/R3K3 w Q - 0 1";
  const explanation = explainMove({ beforeFen, playedMove: "h2h3", bestMove: "a1a7", playedLine: FORK_LINE, bestLine: ["a1a7"], classification: "blunder", family: "kia" });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
  assert.match(explanation.explanation, /no concrete cause/);
});

test("a one-move learner PV cannot substantiate a claim that the learner missed material", () => {
  const beforeFen = "4k3/p6p/8/8/8/8/7P/R3K3 w - - 0 1";
  const explanation = explainMove({ beforeFen, playedMove: "h2h3", bestMove: "a1a7", playedLine: ["h2h3"], bestLine: ["a1a7", "h7h6", "h2h3"], classification: "mistake", family: "kia" });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
});

test("a truncated mate PV is attributed to the engine and stays limited", () => {
  const board = new Chess(); board.move("f3"); board.move("e5");
  const explanation = explainMove({ beforeFen: board.fen(), playedMove: "g2g4", bestMove: "e2e4", playedLine: ["g2g4"], bestLine: ["e2e4"], classification: "blunder", family: "kia", playedScore: mate(-1), bestScore: cp(0) });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
  assert.match(explanation.explanation, /engine reports a forced mate in 1 against you/);
  assert.match(explanation.explanation, /not a fully replay-verified explanation/);
});

test("a mating benefit is verified only if the displayed continuation actually reaches mate", () => {
  const board = new Chess(); board.move("f3");
  const line = ["e7e5", "g2g4", "d8h4"];
  const explanation = explainMove({ beforeFen: board.fen(), playedMove: "e7e5", bestMove: "e7e5", playedLine: line, bestLine: line, classification: "best", family: "pirc" });
  assert.equal(explanation.confidence, "verified");
  assert.equal(explanation.evidence[0].kind, "checkmate");
  assert.match(explanation.explanation, /displayed engine continuation/);
  const truncated = explainMove({ beforeFen: board.fen(), playedMove: "e7e5", bestMove: "e7e5", playedLine: ["e7e5"], bestLine: ["e7e5"], classification: "best", family: "pirc", bestScore: mate(2), playedScore: mate(2) });
  assert.equal(truncated.confidence, "limited");
  assert.match(truncated.explanation, /engine reports a forced mate in 2 for you/);
});

test("Pirc Nxe4 explains the early knight-for-pawn loss even when the long PV ends in a later capture", () => {
  const board = new Chess(openingRecallPrompts[0].fen);
  board.move("Bg7"); board.move("Nf3");
  const playedLine = ["f6e4", "c3e4", "e8g8", "f1e2", "c7c5", "d4c5", "d6d5", "e4f2", "d8a5", "c2c3", "a5c5"];
  const bestLine = ["e8g8", "f1d3", "c7c5", "d4d5", "b8a6"];
  assert.equal(replayCoachingLine(board.fen(), playedLine).materialSettled, false);
  const explanation = explainMove({ beforeFen: board.fen(), playedMove: "f6e4", bestMove: "e8g8", playedLine, bestLine, classification: "blunder", family: "pirc" });
  assert.equal(explanation.confidence, "verified");
  assert.equal(explanation.evidence[0].kind, "material");
  assert.match(explanation.explanation, /Your knight on e4 is captured by White's Nxe4/);
  assert.match(explanation.explanation, /trade your knight for a pawn/);
  assert.match(explanation.explanation, /first 4 plies/);
  assert.match(explanation.explanation, /same 4 plies/);
  assert.match(explanation.explanation, /falls by 2 pawn-value points/);
});

test("later capture-recapture transients do not erase the verified early Pirc knight loss", () => {
  const board = new Chess(openingRecallPrompts[0].fen);
  board.move("Bg7"); board.move("Nf3");
  const beforeFen = board.fen();
  const asUci = (sans: string): string[] => {
    const replay = new Chess(beforeFen);
    return sans.split(" ").map((san) => {
      const move = replay.move(san);
      return `${move.from}${move.to}${move.promotion ?? ""}`;
    });
  };
  const playedLine = asUci("Nxe4 Nxe4 O-O c3 Nd7 Be2 e5 fxe5 dxe5 dxe5 Qe7 O-O Nxe5 Bg5 Nxf3+ Bxf3 Qe6 Bh4");
  const bestLine = asUci("O-O Bd3 Nc6 e5 dxe5 fxe5 Ng4 h3 Nh6 Ne2 f6 O-O fxe5 dxe5 Nf7");
  assert.equal(replayCoachingLine(beforeFen, playedLine).materialSettled, true);
  assert.equal(replayCoachingLine(beforeFen, bestLine).materialSettled, false);
  const explanation = explainMove({ beforeFen, playedMove: "f6e4", bestMove: "e8g8", playedLine, bestLine, classification: "blunder", family: "pirc" });
  assert.equal(explanation.confidence, "verified");
  assert.match(explanation.explanation, /Your knight on e4 is captured by White's Nxe4/);
  assert.match(explanation.explanation, /trade your knight for a pawn/);
  assert.match(explanation.explanation, /first 4 plies/);
});

test("an early quiet prefix cannot cherry-pick a sacrifice recovered later in the same PV", () => {
  const beforeFen = "3qk3/7p/8/8/8/4n3/7P/R2QK3 w Q - 0 1";
  const playedLine = ["h2h3", "e3c2", "e1f2", "c2a1", "d1a4", "e8f7", "a4d7", "f7f6", "d7d8"];
  const bestLine = ["a1a2", "e3d5", "h2h3", "h7h6", "d1e2", "e8f8", "h3h4", "h6h5"];
  const replay = replayCoachingLine(beforeFen, playedLine);
  assert.equal(replay.legal, true);
  assert.equal(replay.materialChange, 400);
  assert.equal(replay.materialSettled, false);
  const explanation = explainMove({ beforeFen, playedMove: "h2h3", bestMove: "a1a2", playedLine, bestLine, classification: "blunder", family: "kia" });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
});

test("a bad move's early prefix needs an equally settled alternative at the same horizon", () => {
  const board = new Chess(openingRecallPrompts[0].fen);
  board.move("Bg7"); board.move("Nf3");
  const playedLine = ["f6e4", "c3e4", "e8g8", "f1e2", "c7c5", "d4c5"];
  // The alternative's third ply starts a fresh exchange, so no shared quiet
  // comparison exists inside its four available plies.
  const bestLine = ["e8g8", "f1d3", "f6e4", "c3e4"];
  const explanation = explainMove({ beforeFen: board.fen(), playedMove: "f6e4", bestMove: "e8g8", playedLine, bestLine, classification: "blunder", family: "pirc" });
  assert.equal(explanation.confidence, "limited");
  assert.deepEqual(explanation.evidence, []);
});

test("authored explanations attach only to a matching position AND move", () => {
  const prompt = openingRecallPrompts[0];
  assert.equal(authoredMoveContext(prompt.fen, "f8g7", "pirc"), prompt.explanation);
  assert.equal(authoredMoveContext(prompt.fen, "c7c6", "pirc"), undefined);
  assert.equal(authoredMoveContext(prompt.fen, "f8g7", "kid"), undefined);
  assert.equal(authoredMoveContext(START, "g1f3", "pirc"), undefined);
  const changedClocks = prompt.fen.replace("0 4", "11 9");
  assert.equal(authoredMoveContext(changedClocks, "f8g7", "pirc"), prompt.explanation);
});

test("structure guidance is conditional and explicitly separate from the move's engine rating", () => {
  assert.equal(openingStrategicContext(START, "kid"), undefined);
  assert.match(openingStrategicContext(openingRecallPrompts[0].fen, "pirc")!, /not the reason for the move rating/);
  assert.equal(openingStrategicContext(openingRecallPrompts[0].fen, "kia"), undefined);
});

test("a sound off-book move remains good; authored text is not substituted for its cause", () => {
  const prompt = openingRecallPrompts[0];
  const explanation = explainMove({ beforeFen: prompt.fen, playedMove: "c7c6", bestMove: "f8g7", playedLine: ["c7c6"], bestLine: ["f8g7"], classification: "good", family: "pirc" });
  assert.match(explanation.explanation, /sound alternative/);
  assert.ok(explanation.evidence.every((item) => item.kind === "position"));
  assert.equal(explanation.confidence, "limited");
  assert.equal(explanation.lesson?.basis, "position");
  assert.match(explanation.authoredContext!, /Repertoire note for Bg7/);
  assert.doesNotMatch(explanation.explanation, /develops, pressures the long diagonal/);
});

test("forced-root search scores a move absent from top PV, preserving complete history and maximum coaching skill", async () => {
  const moves = ["e2e4", "e7e5"];
  const board = new Chess(); for (const move of moves) board.move({ from: move.slice(0, 2), to: move.slice(2, 4) });
  const calls: { fen: string; options?: EngineSearchOptions }[] = [];
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    calls.push({ fen, options });
    return options?.searchMoves ? engineResult(fen, ["b1c3", "g8f6"], cp(12)) : engineResult(fen, ["g1f3", "b8c6"], cp(35));
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves, playedMove: "b1c3", family: "kia" });
  assert.equal(assessment.classification, "good");
  assert.equal(assessment.lossCp, 23);
  assert.equal(assessment.playedSan, "Nc3");
  assert.equal(assessment.bestSan, "Nf3");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.fen, board.fen());
    assert.deepEqual(call.options?.history, { initialFen: START, moves });
    assert.equal(call.options?.skillLevel, 20);
    assert.equal(call.options?.nodes, 60_000);
    assert.equal(call.options?.moveTimeMs, 1_500);
  }
  assert.deepEqual(calls[1].options?.searchMoves, ["b1c3"]);
  assert.deepEqual(JSON.parse(JSON.stringify(assessment)), assessment);
});

test("black's assessment uses black root scores without reversing them", async () => {
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    return options?.searchMoves ? engineResult(fen, ["e7e5"], cp(-325)) : engineResult(fen, ["c7c5"], cp(-300));
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: ["e2e4"], playedMove: "e7e5", family: "pirc" });
  assert.equal(assessment.classification, "good");
  assert.equal(assessment.lossCp, 25);
});

test("large errors receive a deeper confirmation, using the final comparison", async () => {
  const calls: EngineSearchOptions[] = [];
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options = {}) {
    calls.push(options);
    return options.searchMoves ? engineResult(fen, FORK_LINE, cp(-500)) : engineResult(fen, AVOID_FORK_LINE, cp(0));
  } };
  const assessment = await assessMove(engine, { initialFen: FORK_FEN, moves: [], playedMove: "h2h3", family: "kia" });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.nodes), [60_000, 60_000, 120_000, 120_000]);
  assert.equal(assessment.classification, "blunder");
  assert.equal(assessment.confidence, "verified");
});

test("a bounded aspiration cutoff uses the exact completed iteration for the same root, preserving its full replay", async () => {
  let calls = 0;
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    calls++;
    const chosen = Boolean(options?.searchMoves);
    const line = chosen ? ["d2d4", "d7d5", "g1f3"] : ["e2e4", "e7e5", "g1f3"];
    return {
      ...engineResult(fen, [line[0]], { ...cp(chosen ? 15 : 40), bound: "lower" }),
      completedLines: [{ multipv: 1, depth: 13, pv: line, score: cp(chosen ? 12 : 35) }],
    };
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: [], playedMove: "d2d4", family: "kia" });
  assert.equal(calls, 2);
  assert.equal(assessment.classification, "good");
  assert.equal(assessment.lossCp, 23);
  assert.deepEqual(assessment.bestScore, cp(35));
  assert.deepEqual(assessment.playedScore, cp(12));
  assert.deepEqual(assessment.bestLine, ["e2e4", "e7e5", "g1f3"]);
  assert.deepEqual(assessment.playedLine, ["d2d4", "d7d5", "g1f3"]);
});

test("a completed PV for a different root cannot turn an aspiration bound into a rating", async () => {
  let calls = 0;
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    calls++;
    const chosen = Boolean(options?.searchMoves);
    return {
      ...engineResult(fen, [chosen ? "d2d4" : "e2e4"], { ...cp(30), bound: "lower" }),
      completedLines: [{ multipv: 1, depth: 13, pv: ["g1f3", "d7d5"], score: cp(25) }],
    };
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: [], playedMove: "d2d4", family: "kia" });
  assert.equal(calls, 4);
  assert.equal(assessment.classification, "unrated");
  assert.equal(assessment.lossCp, undefined);
  assert.equal(assessment.bestScore?.bound, "lower");
  assert.deepEqual(assessment.bestLine, ["e2e4"]);
});

test("a new bound contradicting the prior complete value triggers rechecking and stays unrated", async () => {
  let calls = 0;
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    calls++;
    const root = options?.searchMoves ? "d2d4" : "e2e4";
    return {
      ...engineResult(fen, [root], { ...cp(100), bound: "lower" }),
      completedLines: [{ multipv: 1, depth: 13, pv: [root, "d7d5"], score: cp(0) }],
    };
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: [], playedMove: "d2d4", family: "kia" });
  assert.equal(calls, 4);
  assert.equal(assessment.classification, "unrated");
  assert.equal(assessment.bestScore?.bound, "lower");
});

test("stale perspective and illegal PVs cannot supply a move rating", async () => {
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    const result = engineResult(fen, options?.searchMoves ? ["d2d4", "d7d6", "d4d6"] : ["e2e4"], cp(0));
    if (!options?.searchMoves) result.perspective = "b";
    return result;
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: [], playedMove: "d2d4", family: "kia" });
  assert.equal(assessment.classification, "unrated");
  assert.equal(assessment.confidence, "limited");
  assert.equal(assessment.lossCp, undefined);
});

test("immediate legal checkmate is verified without engine calls", async () => {
  const engine: Pick<StockfishClient, "analyze"> = { async analyze() { throw new Error("should not be called"); } };
  const assessment = await assessMove(engine, { initialFen: START, moves: ["f2f3", "e7e5", "g2g4"], playedMove: "d8h4", family: "pirc" });
  assert.equal(assessment.classification, "best");
  assert.equal(assessment.confidence, "verified");
  assert.equal(assessment.playedSan, "Qh4#");
  assert.equal(assessment.lossCp, undefined);
  assert.match(assessment.explanation, /no legal reply/);
});

test("a mate blunder explains the replayable mating continuation, not a fake numeric loss", async () => {
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options) {
    return options?.searchMoves ? engineResult(fen, ["g2g4", "d8h4"], mate(-1)) : engineResult(fen, ["e2e4", "g8f6"], cp(-25));
  } };
  const assessment = await assessMove(engine, { initialFen: START, moves: ["f2f3", "e7e5"], playedMove: "g2g4", family: "kia" });
  assert.equal(assessment.classification, "blunder");
  assert.equal(assessment.lossCp, undefined);
  assert.match(assessment.title, /mating line/);
  assert.equal(assessment.evidence[0].kind, "checkmate");
});

test("cancellation stops before searches and between the two compared searches", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(assessMove({ async analyze() { throw new Error("should not run"); } }, { initialFen: START, moves: [], playedMove: "e2e4", family: "kia", signal: controller.signal }), EngineCancelledError);
  const active = new AbortController();
  let calls = 0;
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen) { calls++; active.abort(); return engineResult(fen, ["e2e4"], cp(10)); } };
  await assert.rejects(assessMove(engine, { initialFen: START, moves: [], playedMove: "d2d4", family: "kia", signal: active.signal }), EngineCancelledError);
  assert.equal(calls, 1);
});

test("illegal user moves and repeated terminal game history are rejected before evaluation", async () => {
  const engine: Pick<StockfishClient, "analyze"> = { async analyze() { throw new Error("should not be called"); } };
  await assert.rejects(assessMove(engine, { initialFen: START, moves: [], playedMove: "e2e5", family: "kia" }), /Invalid move/);
  await assert.rejects(assessMove(engine, { initialFen: START, moves: ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"], playedMove: "e2e4", family: "kia" }), /game is over/);
});
