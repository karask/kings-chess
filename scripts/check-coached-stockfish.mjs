#!/usr/bin/env node
/**
 * Optional real-WASM integration smoke check (not part of the fast unit suite).
 * Run: node --import tsx scripts/check-coached-stockfish.mjs
 *
 * Uses the production client and worker coordinator without modification. Only
 * the browser Worker transport is adapted to the installed Stockfish Node API;
 * engine replies and evaluations are real, not fixtures. Browser asset loading
 * and rendering still require a separate browser check.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Chess } from "chess.js";
import initializeStockfish from "stockfish";

import { moveToUci, parseUciMove } from "../lib/chess.ts";
import { assessMove, replayCoachingLine } from "../lib/coaching.ts";
import { appendGameMove, createCoachedGame, gameBoard, gameResult, loadCoachedGame, saveCoachedGame, validateCoachedGame } from "../lib/coached-game.ts";
import { EngineCancelledError, StockfishClient } from "../lib/engine.ts";
import { clearLocalData, closeChessTrainerDb } from "../lib/storage.ts";

const coordinatorPath = fileURLToPath(new URL("../public/stockfish-engine.worker.js", import.meta.url));
const coordinatorSource = readFileSync(coordinatorPath, "utf8");
const transports = [];

class StockfishModule {
  onmessage = null;
  onerror = null;
  commands = [];
  lines = [];
  terminated = false;
  ready = false;
  pending = [];

  constructor() {
    transports.push(this);
    this.module = initializeStockfish("lite-single", (error, engine) => {
      if (error) { this.onerror?.({ message: error.message }); return; }
      this.ready = true;
      for (const command of this.pending) engine.sendCommand(command);
      this.pending.length = 0;
    });
    this.module.listener = (data) => {
      this.lines.push(data);
      if (!this.terminated) this.onmessage?.({ data });
    };
  }

  postMessage(command) {
    if (this.terminated) return;
    this.commands.push(command);
    // The Node API's quit exits the process, unlike a nested browser worker.
    if (command === "quit") { this.terminate(); return; }
    if (this.ready) this.module.sendCommand(command);
    else this.pending.push(command);
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.pending.length = 0;
    if (this.ready) this.module.sendCommand("stop");
  }
}

class CoordinatorWorker {
  onmessage = null;
  onerror = null;
  terminated = false;

  constructor() {
    this.self = {
      location: { href: "http://localhost/stockfish-engine.worker.js" },
      postMessage: (data) => queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data }); }),
      close: () => { this.terminated = true; },
      onmessage: null,
    };
    const context = vm.createContext({ self: this.self, Worker: StockfishModule, WebAssembly, URL });
    vm.runInContext(coordinatorSource, context, { filename: coordinatorPath });
  }

  postMessage(data) {
    if (this.terminated) return;
    try { this.self.onmessage({ data }); }
    catch (error) { this.onerror?.({ message: error.message }); }
  }

  terminate() { this.terminated = true; }
}

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CoordinatorWorker });

const client = new StockfishClient({ initializationTimeoutMs: 10_000 });
const began = performance.now();

function fresh() {
  return createCoachedGame({ family: "kia", scenarioId: "kia-e6", startMode: "start", skillLevel: 3, coaching: "every" });
}

function assertLegalAnalysis(analysis) {
  const board = new Chess(analysis.fen);
  assert.ok(analysis.bestMove, "real engine returns a legal best move");
  board.move(parseUciMove(analysis.bestMove));
  for (const line of analysis.lines) {
    assert.ok(replayCoachingLine(analysis.fen, line.pv).legal, "every real PV replays legally");
  }
}

function lastSearchCommands() {
  const commands = transports.at(-1).commands;
  const lastGo = commands.findLastIndex((command) => command.startsWith("go "));
  return commands.slice(lastGo - 3, lastGo + 1);
}

try {
  assert.equal(await client.initialize(), true, client.unavailableReason ?? "engine initialization");
  console.log("PASS: production coordinator completed UCI handshake with Stockfish 18 lite-single WASM.");

  const initialFen = new Chess().fen();
  const opponent = await client.analyze(initialFen, { nodes: 8_000, skillLevel: 3, timeoutMs: 10_000 });
  assertLegalAnalysis(opponent);
  assert.ok(lastSearchCommands().includes("setoption name Skill Level value 3"));

  const restricted = await client.analyze(initialFen, { nodes: 10_000, searchMoves: ["g1h3"], timeoutMs: 10_000 });
  assertLegalAnalysis(restricted);
  assert.equal(restricted.bestMove, "g1h3");
  assert.equal(restricted.lines[0].pv[0], "g1h3");
  assert.ok(lastSearchCommands().includes("setoption name Skill Level value 20"));
  assert.match(lastSearchCommands().at(-1), /searchmoves g1h3$/);
  console.log("PASS: restricted root search returns Nh3; full-strength coaching resets opponent skill 3 to 20.");

  const repetitionMoves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"];
  const repetitionBoard = new Chess(initialFen);
  repetitionMoves.forEach((move) => repetitionBoard.move(parseUciMove(move)));
  const repeated = await client.analyze(repetitionBoard.fen(), {
    nodes: 12_000, searchMoves: ["f6g8"], history: { initialFen, moves: repetitionMoves }, timeoutMs: 10_000,
  });
  assert.equal(repeated.bestMove, "f6g8");
  assert.equal(repeated.lines[0].score?.type, "cp");
  assert.equal(repeated.lines[0].score?.value, 0);
  assert.ok(lastSearchCommands().includes(`position fen ${initialFen} moves ${repetitionMoves.join(" ")}`));
  let drawn = fresh();
  for (const move of [...repetitionMoves, "f6g8"]) drawn = appendGameMove(drawn, move);
  assert.equal(gameResult(drawn), "Draw by threefold repetition");
  console.log("PASS: actual engine receives full history and scores the threefold continuation as a draw.");

  let firstInfo;
  const started = new Promise((resolve) => { firstInfo = resolve; });
  const longSearch = client.analyze(initialFen, { depth: 99, timeoutMs: 10_000, onInfo: () => firstInfo() });
  const cancelled = assert.rejects(longSearch, EngineCancelledError);
  await started;
  client.stop("real engine cancellation check");
  await cancelled;
  const replacement = await client.analyze(initialFen, { nodes: 4_000, searchMoves: ["b1c3"], timeoutMs: 10_000 });
  assert.equal(replacement.bestMove, "b1c3");
  assert.equal(replacement.lines[0].pv[0], "b1c3");
  console.log("PASS: cancellation and serialized replacement reject stale output from the real engine.");

  let game = appendGameMove(appendGameMove(fresh(), "f2f3"), "e7e5");
  const assessment = await assessMove(client, {
    initialFen: game.initialFen, moves: [...game.moves], playedMove: "g2g4", family: game.family,
  });
  assert.ok(["mistake", "blunder"].includes(assessment.classification), `expected a losing-move verdict, got ${assessment.classification}`);
  assert.equal(assessment.playedScore?.type, "mate");
  assert.ok(assessment.playedScore.value < 0);
  assert.equal(assessment.playedLine[0], "g2g4");
  assert.ok(assessment.evidence.some((item) => item.kind === "checkmate"));
  assert.ok(replayCoachingLine(assessment.beforeFen, assessment.playedLine).legal);
  assert.equal(replayCoachingLine(assessment.beforeFen, assessment.playedLine).checkmated, "w");
  game = appendGameMove(game, "g2g4");
  game = { ...game, assessments: [{ ply: 3, assessment }], pausedAtPly: 3 };
  validateCoachedGame(game);
  await clearLocalData();
  await saveCoachedGame(game);
  closeChessTrainerDb();
  assert.deepEqual(await loadCoachedGame(), game);
  console.log(`PASS: real ${assessment.classification} assessment explains the mating line and survives validated persistence.`);

  const pirc = createCoachedGame({ family: "pirc", scenarioId: "pirc-austrian", startMode: "tabiya", skillLevel: 3, coaching: "every" });
  const rawStart = transports.at(-1).lines.length;
  const pircAssessment = await assessMove(client, {
    initialFen: pirc.initialFen, moves: [], playedMove: "f8g7", family: "pirc",
  });
  if (pircAssessment.classification === "unrated" || pircAssessment.playedLine.length <= 1) {
    console.log("Bg7 assessment details:", { classification: pircAssessment.classification, bestScore: pircAssessment.bestScore, playedScore: pircAssessment.playedScore, bestLine: pircAssessment.bestLine, playedLine: pircAssessment.playedLine });
    console.log("Bg7 raw final search info:", transports.at(-1).lines.slice(rawStart).filter((line) => /^(info depth|bestmove)/.test(line)).slice(-18));
  }
  assert.equal(pircAssessment.playedLine[0], "f8g7");
  assert.ok(pircAssessment.playedScore, "real Bg7 search preserves its scored PV");
  assert.ok(pircAssessment.playedLine.length > 1, "normal opening continuation is not reduced to just the learner move");
  validateCoachedGame({ ...appendGameMove(pirc, "f8g7"), assessments: [{ ply: 1, assessment: pircAssessment }] });
  console.log(`PASS: Austrian Bg7 assessment retains ${pircAssessment.playedLine.length}-ply PV; ${JSON.stringify({ classification: pircAssessment.classification, bestMove: pircAssessment.bestMove, bestScore: pircAssessment.bestScore, playedScore: pircAssessment.playedScore })}`);

  const quiet = await assessMove(client, { initialFen, moves: [], playedMove: "g1f3", family: "kia" });
  assert.equal(quiet.lesson?.basis, "position", "real quiet-move analysis produces a positional lesson");
  assert.match(quiet.lesson.yourMove, /f3/);
  assert.ok(quiet.lesson.takeaway);
  assert.equal(quiet.confidence, "limited", "positional facts are not labeled a tactical proof");
  validateCoachedGame({ ...appendGameMove(fresh(), "g1f3"), assessments: [{ ply: 1, assessment: quiet }] });
  console.log(`PASS: real Nf3 analysis teaches the central task: ${quiet.lesson.yourMove}`);

  // Report domain cost, not a machine-dependent pass/fail timing assertion.
  const sample = fresh();
  const sampleBoard = new Chess(sample.initialFen);
  let seed = 19;
  while (sample.moves.length < 120 && !sampleBoard.isGameOver()) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const legal = sampleBoard.moves({ verbose: true });
    const selected = legal[seed % legal.length];
    sample.moves.push(moveToUci(sampleBoard.move(selected)));
  }
  const replayStarted = performance.now();
  gameBoard(sample);
  const replayMs = performance.now() - replayStarted;
  const validationStarted = performance.now();
  validateCoachedGame(sample);
  const validationMs = performance.now() - validationStarted;
  console.log(`TIMING: ${sample.moves.length}-ply history replay ${replayMs.toFixed(1)} ms; validation ${validationMs.toFixed(1)} ms (no assessments).`);
  console.log(`Real Stockfish smoke checks passed in ${((performance.now() - began) / 1000).toFixed(1)} seconds.`);
} catch (error) {
  console.error("Real Stockfish smoke check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.dispose();
  for (const transport of transports) transport.terminate();
  await clearLocalData();
  closeChessTrainerDb();
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
  if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
  else Reflect.deleteProperty(globalThis, "Worker");
}
