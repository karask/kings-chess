import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Chess } from "chess.js";

import { ChessDataError, parseUciMove } from "../lib/chess";

import {
  EngineCancelledError,
  StockfishClient,
} from "../lib/engine";

const WHITE_TO_MOVE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

type WorkerCommand = {
  type: string;
  generation?: number;
  [key: string]: unknown;
};

class ControllableWorker {
  static instances: ControllableWorker[] = [];

  readonly messages: WorkerCommand[] = [];
  readonly url: string | URL;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(url: string | URL) {
    this.url = url;
    ControllableWorker.instances.push(this);
  }

  postMessage(message: WorkerCommand): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function installBrowserWorkerHarness(t: TestContext): void {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: ControllableWorker,
  });

  t.after(() => {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
    else Reflect.deleteProperty(globalThis, "Worker");
    ControllableWorker.instances.length = 0;
  });
}

async function waitForCommand(
  worker: ControllableWorker,
  type: string,
  generation?: number,
): Promise<WorkerCommand> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const command = worker.messages.find(
      (message) =>
        message.type === type &&
        (generation === undefined || message.generation === generation),
    );
    if (command) return command;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Worker did not receive ${type} for generation ${generation ?? "any"}.`);
}

async function readyClient(options: ConstructorParameters<typeof StockfishClient>[0] = {}) {
  const client = new StockfishClient({
    initializationTimeoutMs: 1_000,
    ...options,
  });
  const initialization = client.initialize();
  const worker = ControllableWorker.instances.at(-1);
  assert.ok(worker, "initializing creates the coordinator worker");
  worker.emit({ type: "ready" });
  assert.equal(await initialization, true);
  return { client, worker };
}

test("StockfishClient worker contract", async (t) => {
  installBrowserWorkerHarness(t);

  await t.test("passes fixed search options and custom asset URLs", async () => {
    const { client, worker } = await readyClient({
      workerUrl: "/test/coordinator.js",
      engineUrl: "/test/stockfish.js",
    });

    try {
      assert.equal(worker.url, "/test/coordinator.js");
      assert.deepEqual(worker.messages[0], {
        type: "init",
        engineUrl: "/test/stockfish.js",
      });

      const pending = client.analyze(WHITE_TO_MOVE, {
        depth: 17,
        moveTimeMs: 425,
        nodes: 81_000,
        multiPv: 3,
      });
      const command = await waitForCommand(worker, "analyze", 1);
      assert.deepEqual(command, {
        type: "analyze",
        generation: 1,
        fen: WHITE_TO_MOVE,
        multiPv: 3,
        skillLevel: 20,
        limits: { depth: 17, moveTimeMs: 425, nodes: 81_000 },
      });

      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4 ponder e7e5" });
      assert.equal((await pending).bestMove, "e2e4");
    } finally {
      client.dispose();
    }
  });

  await t.test("preserves repetition history and snapshots normalized caller inputs", async () => {
    const { client, worker } = await readyClient();
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const board = new Chess(WHITE_TO_MOVE);
    moves.forEach((move) => board.move(parseUciMove(move)));
    const expectedFen = board.fen();
    const history = { initialFen: WHITE_TO_MOVE, moves: moves.map((move) => move.toUpperCase()) };
    const searchMoves = [" E2E4 ", "d2d4", "e2e4"];

    try {
      const pending = client.analyze(expectedFen, { history, searchMoves, skillLevel: 4, nodes: 2_000 });
      history.moves.length = 0;
      searchMoves[0] = "a1a8";
      const command = await waitForCommand(worker, "analyze", 1);
      assert.deepEqual(command.history, { initialFen: WHITE_TO_MOVE, moves });
      assert.deepEqual(command.searchMoves, ["e2e4", "d2d4"]);
      assert.equal(command.skillLevel, 4);
      assert.equal(command.fen, expectedFen);
      assert.equal(expectedFen.split(" ").slice(4).join(" "), "4 3");
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      await pending;

      const coach = client.analyze(expectedFen, { nodes: 4_000 });
      const coachCommand = await waitForCommand(worker, "analyze", 2);
      assert.equal(coachCommand.skillLevel, 20);
      assert.equal(coachCommand.history, undefined);
      assert.equal(coachCommand.searchMoves, undefined);
      worker.emit({ type: "line", generation: 2, line: "bestmove d2d4" });
      await coach;
    } finally {
      client.dispose();
    }
  });

  await t.test("validates history and root moves without interrupting a running search", async () => {
    const { client, worker } = await readyClient();
    try {
      const pending = client.analyze(WHITE_TO_MOVE, { nodes: 4_000 });
      await waitForCommand(worker, "analyze", 1);
      await assert.rejects(client.analyze(WHITE_TO_MOVE, {
        history: { initialFen: WHITE_TO_MOVE, moves: ["e2e5"] },
      }), (error: unknown) => error instanceof ChessDataError && /ply 1/.test(error.message));
      await assert.rejects(client.analyze(WHITE_TO_MOVE, {
        history: { initialFen: WHITE_TO_MOVE, moves: ["e2e4"] },
      }), /does not end at the analysis FEN/);
      await assert.rejects(client.analyze(WHITE_TO_MOVE, {
        history: { initialFen: WHITE_TO_MOVE, moves: ["g1f3", "g8f6", "f3g1", "f6g8"] },
      }), /including clocks/);
      await assert.rejects(client.analyze(WHITE_TO_MOVE, { searchMoves: [] }), /nonempty/);
      await assert.rejects(client.analyze(WHITE_TO_MOVE, { searchMoves: ["e7e5"] }), /Illegal searchMoves/);
      await assert.rejects(client.analyze(WHITE_TO_MOVE, { searchMoves: ["e2e4\nquit"] }), /Invalid UCI/);
      for (const skillLevel of [-1, 21, 4.5, Number.NaN]) {
        await assert.rejects(client.analyze(WHITE_TO_MOVE, { skillLevel }), RangeError);
      }
      assert.equal(worker.messages.filter(({ type }) => type === "analyze").length, 1);
      assert.equal(worker.messages.filter(({ type }) => type === "stop").length, 0);
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      assert.equal((await pending).bestMove, "e2e4");
    } finally {
      client.dispose();
    }
  });

  await t.test("accepts legal castling, en passant, and underpromotion in history and root filters", async () => {
    const { client, worker } = await readyClient();
    const cases = [
      { initialFen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", moves: ["e1g1"], root: "e8c8" },
      { initialFen: "4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1", moves: ["d7d5"], root: "e5d6" },
      { initialFen: "7k/P7/8/8/8/8/8/7K w - - 0 1", moves: [], root: "a7a8n" },
    ];
    try {
      for (const [index, fixture] of cases.entries()) {
        const board = new Chess(fixture.initialFen);
        fixture.moves.forEach((move) => board.move(parseUciMove(move)));
        const pending = client.analyze(board.fen(), {
          history: { initialFen: fixture.initialFen, moves: fixture.moves },
          searchMoves: [fixture.root],
          skillLevel: 0,
        });
        const command = await waitForCommand(worker, "analyze", index + 1);
        assert.equal(command.skillLevel, 0);
        assert.deepEqual(command.searchMoves, [fixture.root]);
        worker.emit({ type: "line", generation: index + 1, line: `bestmove ${fixture.root}` });
        await pending;
      }
    } finally {
      client.dispose();
    }
  });

  await t.test("rejects a superseded search and ignores its late generation", async () => {
    const { client, worker } = await readyClient();

    try {
      const first = client.analyze(WHITE_TO_MOVE, { depth: 8 });
      const firstRejection = assert.rejects(
        first,
        (error: unknown) =>
          error instanceof EngineCancelledError &&
          error.message === "superseded by a newer analysis",
      );
      await waitForCommand(worker, "analyze", 1);

      const infoCalls: number[] = [];
      const second = client.analyze(BLACK_TO_MOVE, {
        depth: 12,
        onInfo: (line) => infoCalls.push(line.depth),
      });
      const stop = await waitForCommand(worker, "stop", 1);
      assert.equal(stop.reason, "superseded by a newer analysis");
      await waitForCommand(worker, "analyze", 2);
      await firstRejection;

      worker.emit({
        type: "line",
        generation: 1,
        line: "info depth 99 score cp 9999 pv e2e4",
      });
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      assert.deepEqual(infoCalls, []);

      worker.emit({
        type: "line",
        generation: 2,
        line: "info depth 12 score cp 31 pv e7e5 g1f3",
      });
      worker.emit({ type: "line", generation: 2, line: "bestmove e7e5 ponder g1f3" });

      const result = await second;
      assert.equal(result.generation, 2);
      assert.equal(result.bestMove, "e7e5");
      assert.deepEqual(result.lines.map(({ depth }) => depth), [12]);
      assert.deepEqual(infoCalls, [12]);
    } finally {
      client.dispose();
    }
  });

  await t.test("explicit stop rejects once and sends the active generation", async () => {
    const { client, worker } = await readyClient();

    try {
      const pending = client.analyze(WHITE_TO_MOVE, { moveTimeMs: 250 });
      const rejection = assert.rejects(
        pending,
        (error: unknown) =>
          error instanceof EngineCancelledError && error.message === "user requested stop",
      );
      await waitForCommand(worker, "analyze", 1);

      client.stop("user requested stop");
      client.stop("duplicate stop is harmless");
      await rejection;

      const stops = worker.messages.filter(({ type }) => type === "stop");
      assert.deepEqual(stops, [
        { type: "stop", generation: 1, reason: "user requested stop" },
      ]);
      assert.equal(client.status, "ready");
    } finally {
      client.dispose();
    }
  });

  await t.test("partial progress does not erase the last scored PV when a budget ends mid-depth", async () => {
    const { client, worker } = await readyClient();
    const progress: Array<{ depth: number; retainedDepth?: number }> = [];
    try {
      const pending = client.analyze(WHITE_TO_MOVE, {
        nodes: 60_000,
        onInfo: (line, allLines) => progress.push({ depth: line.depth, retainedDepth: allLines[0]?.depth }),
      });
      await waitForCommand(worker, "analyze", 1);
      for (const line of [
        "info depth 10 score cp 23 nodes 50000 pv e2e4 e7e5",
        "info depth 11 currmove d2d4 currmovenumber 3",
        "info depth 11 nodes 59999 nps 20000",
        "info depth 11 score cp 30",
        "info depth 11 pv d2d4 d7d5",
      ]) worker.emit({ type: "line", generation: 1, line });
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      const analysis = await pending;
      assert.equal(analysis.lines.length, 1);
      assert.equal(analysis.lines[0].depth, 10);
      assert.deepEqual(analysis.lines[0].score, { type: "cp", value: 23 });
      assert.deepEqual(analysis.lines[0].pv, ["e2e4", "e7e5"]);
      assert.deepEqual(progress.map(({ retainedDepth }) => retainedDepth), [10, 10, 10, 10, 10]);
      assert.deepEqual(progress.map(({ depth }) => depth), [10, 11, 11, 11, 11]);
    } finally {
      client.dispose();
    }
  });

  await t.test("does not mask a newer bound or a changed best move with an older exact score", async () => {
    const { client, worker } = await readyClient();
    try {
      const pending = client.analyze(WHITE_TO_MOVE, { nodes: 60_000 });
      await waitForCommand(worker, "analyze", 1);
      worker.emit({ type: "line", generation: 1, line: "info depth 10 score cp 23 pv e2e4 e7e5" });
      worker.emit({ type: "line", generation: 1, line: "info depth 11 score cp 150 lowerbound pv d2d4" });
      worker.emit({ type: "line", generation: 1, line: "info depth 11 currmove d2d4" });
      worker.emit({ type: "line", generation: 1, line: "bestmove d2d4" });
      const analysis = await pending;
      assert.equal(analysis.lines[0].depth, 11);
      assert.deepEqual(analysis.lines[0].score, { type: "cp", value: 150, bound: "lower" });
      assert.deepEqual(analysis.lines[0].pv, ["d2d4"]);
      assert.equal(analysis.completedLines?.[0].depth, 10);
      assert.deepEqual(analysis.completedLines?.[0].score, { type: "cp", value: 23 });
      assert.deepEqual(analysis.completedLines?.[0].pv, ["e2e4", "e7e5"]);
    } finally {
      client.dispose();
    }
  });

  await t.test("retains separate completed exact iterations when the final iteration ends on a bound", async () => {
    const { client, worker } = await readyClient();
    try {
      const pending = client.analyze(WHITE_TO_MOVE, { nodes: 120_000, multiPv: 2 });
      await waitForCommand(worker, "analyze", 1);
      for (const line of [
        "info depth 11 multipv 1 score cp 25 pv e2e4 e7e5",
        "info depth 12 multipv 1 score cp 23 pv e2e4 c7c5",
        "info depth 12 multipv 2 score cp 21 pv d2d4 d7d5",
        "info depth 13 multipv 1 score cp 31 lowerbound pv e2e4",
        "info depth 13 multipv 2 score cp 19 upperbound pv d2d4",
        "info depth 13 currmove e2e4",
      ]) worker.emit({ type: "line", generation: 1, line });
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      const analysis = await pending;
      assert.deepEqual(analysis.lines.map(({ depth, score }) => ({ depth, score })), [
        { depth: 13, score: { type: "cp", value: 31, bound: "lower" } },
        { depth: 13, score: { type: "cp", value: 19, bound: "upper" } },
      ]);
      assert.deepEqual(analysis.completedLines?.map(({ depth, score, pv }) => ({ depth, score, pv })), [
        { depth: 12, score: { type: "cp", value: 23 }, pv: ["e2e4", "c7c5"] },
        { depth: 12, score: { type: "cp", value: 21 }, pv: ["d2d4", "d7d5"] },
      ]);
    } finally {
      client.dispose();
    }
  });

  await t.test("progress callbacks and returned snapshots cannot mutate retained completed lines", async () => {
    const { client, worker } = await readyClient();
    try {
      const pending = client.analyze(WHITE_TO_MOVE, {
        nodes: 20_000,
        onInfo: (line, allLines) => {
          line.pv[0] = "a1a8";
          if (line.score) line.score.value = 9_999;
          if (allLines[0]) {
            allLines[0].pv.length = 0;
            if (allLines[0].score) allLines[0].score.value = 8_888;
          }
        },
      });
      await waitForCommand(worker, "analyze", 1);
      worker.emit({ type: "line", generation: 1, line: "info depth 12 score cp 23 pv e2e4 e7e5" });
      worker.emit({ type: "line", generation: 1, line: "bestmove e2e4" });
      const analysis = await pending;
      assert.deepEqual(analysis.lines[0].pv, ["e2e4", "e7e5"]);
      assert.equal(analysis.lines[0].score?.value, 23);
      analysis.lines[0].pv[0] = "d2d4";
      analysis.lines[0].score!.value = 7_777;
      assert.deepEqual(analysis.completedLines?.[0].pv, ["e2e4", "e7e5"]);
      assert.equal(analysis.completedLines?.[0].score?.value, 23);
    } finally {
      client.dispose();
    }
  });

  await t.test("keeps cp and mate signs tied to the declared side-to-move perspective", async () => {
    const { client, worker } = await readyClient();

    try {
      const pending = client.analyze(BLACK_TO_MOVE, { depth: 20, multiPv: 2 });
      await waitForCommand(worker, "analyze", 1);
      worker.emit({
        type: "line",
        generation: 1,
        line: "info depth 20 multipv 2 score mate -4 lowerbound pv d7d5 e4d5",
      });
      worker.emit({
        type: "line",
        generation: 1,
        line: "info depth 20 multipv 1 score cp 86 upperbound pv e7e5 g1f3",
      });
      worker.emit({ type: "line", generation: 1, line: "bestmove e7e5" });

      const result = await pending;
      assert.equal(result.perspective, "b");
      assert.deepEqual(result.completedLines, [], "bound-only searches have no completed exact iteration");
      assert.deepEqual(
        result.lines.map(({ multipv, score }) => ({ multipv, score })),
        [
          { multipv: 1, score: { type: "cp", value: 86, bound: "upper" } },
          { multipv: 2, score: { type: "mate", value: -4, bound: "lower" } },
        ],
      );

      // UCI signs are from Black's perspective here. A White learner negates both.
      assert.equal(result.lines[0].score!.value * -1, -86);
      assert.equal(result.lines[1].score!.value * -1, 4);
    } finally {
      client.dispose();
    }
  });
});
