import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const workerSource = readFileSync(new URL("../public/stockfish-engine.worker.js", import.meta.url), "utf8");

function coordinatorHarness() {
  const commands: string[] = [];
  const responses: Array<Record<string, unknown>> = [];
  let terminated = false;
  let closed = false;
  class NestedWorker {
    static instances: NestedWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    constructor() { NestedWorker.instances.push(this); }
    postMessage(command: string) { commands.push(command); }
    terminate() { terminated = true; }
  }
  const coordinator = {
    location: { href: "http://localhost/stockfish-engine.worker.js" },
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(message: Record<string, unknown>) { responses.push(structuredClone(message)); },
    close() { closed = true; },
  };
  runInNewContext(workerSource, { self: coordinator, Worker: NestedWorker, WebAssembly, URL });
  const send = (message: Record<string, unknown>) => coordinator.onmessage?.({ data: message });
  const engineSays = (line: string) => NestedWorker.instances.at(-1)?.onmessage?.({ data: line });
  send({ type: "init", engineUrl: "/engine/stockfish.js" });
  assert.deepEqual(commands, ["uci"]);
  engineSays("uciok");
  assert.equal(commands.at(-1), "isready");
  engineSays("readyok");
  return {
    commands, responses, send, engineSays,
    isTerminated: () => terminated,
    isClosed: () => closed,
  };
}

test("coordinator sends repetition-aware positions, fixed budgets, and restricted root moves", () => {
  const harness = coordinatorHarness();
  harness.send({
    type: "analyze", generation: 1, fen: "unused final FEN", multiPv: 2, skillLevel: 3,
    history: { initialFen: INITIAL_FEN, moves: ["g1f3", "g8f6", "f3g1", "f6g8"] },
    searchMoves: ["e2e4", "d2d4"],
    limits: { depth: 12, moveTimeMs: 300, nodes: 20_000 },
  });
  assert.deepEqual(harness.commands.slice(-4), [
    "setoption name MultiPV value 2",
    "setoption name Skill Level value 3",
    `position fen ${INITIAL_FEN} moves g1f3 g8f6 f3g1 f6g8`,
    "go depth 12 movetime 300 nodes 20000 searchmoves e2e4 d2d4",
  ]);
});

test("coordinator resets weakened opponent skill and root restrictions before coach analysis", () => {
  const harness = coordinatorHarness();
  harness.send({
    type: "analyze", generation: 1, fen: INITIAL_FEN, multiPv: 1,
    skillLevel: 0, searchMoves: ["e2e4"], limits: { nodes: 100 },
  });
  harness.engineSays("bestmove e2e4");
  harness.send({ type: "analyze", generation: 2, fen: INITIAL_FEN, multiPv: 3, limits: {} });
  assert.deepEqual(harness.commands.slice(-4), [
    "setoption name MultiPV value 3",
    "setoption name Skill Level value 20",
    `position fen ${INITIAL_FEN}`,
    "go depth 16",
  ]);
});

test("empty move history does not append a UCI moves token and filtered searches retain a default budget", () => {
  const harness = coordinatorHarness();
  harness.send({
    type: "analyze", generation: 1, fen: INITIAL_FEN, multiPv: 1,
    history: { initialFen: INITIAL_FEN, moves: [] }, searchMoves: ["e2e4"],
  });
  assert.deepEqual(harness.commands.slice(-2), [
    `position fen ${INITIAL_FEN}`,
    "go depth 16 searchmoves e2e4",
  ]);
});

test("coordinator serializes search handoff and tags stopped output with its original generation", () => {
  const harness = coordinatorHarness();
  const job = { type: "analyze", fen: INITIAL_FEN, multiPv: 1, limits: { nodes: 1_000 } };
  harness.send({ ...job, generation: 1, skillLevel: 1 });
  harness.send({ ...job, generation: 2, skillLevel: 2 });
  harness.send({ ...job, generation: 3, skillLevel: 20, searchMoves: ["d2d4"] });
  assert.equal(harness.commands.filter((command) => command.startsWith("go ")).length, 1);
  assert.equal(harness.commands.filter((command) => command === "stop").length, 1);
  assert.ok(harness.responses.some((response) => response.type === "cancelled" && response.generation === 2));

  harness.engineSays("info depth 2 score cp 8 pv e2e4");
  harness.engineSays("bestmove e2e4");
  assert.deepEqual(harness.responses.filter((response) => response.type === "line"), [
    { type: "line", generation: 1, line: "info depth 2 score cp 8 pv e2e4" },
    { type: "line", generation: 1, line: "bestmove e2e4" },
  ]);
  assert.deepEqual(harness.commands.slice(-4), [
    "setoption name MultiPV value 1",
    "setoption name Skill Level value 20",
    `position fen ${INITIAL_FEN}`,
    "go nodes 1000 searchmoves d2d4",
  ]);
  harness.engineSays("bestmove d2d4");
  assert.deepEqual(harness.responses.at(-1), { type: "line", generation: 3, line: "bestmove d2d4" });
  harness.send({ type: "dispose" });
  assert.equal(harness.commands.at(-1), "quit");
  assert.equal(harness.isTerminated(), true);
  assert.equal(harness.isClosed(), true);
});
