import { Chess } from "chess.js";
import { assetUrl } from "./app-url";

import { canonicalFen, ChessDataError, moveToUci, parseUciMove } from "./chess";
import type {
  EngineAnalysis,
  EnginePrincipalVariation,
  EngineScore,
  EngineSearchOptions,
  EngineStatus,
  StockfishClientOptions,
  UciMove,
} from "./types";

interface ActiveSearch {
  generation: number;
  fen: string;
  startedAt: number;
  lines: Map<number, EnginePrincipalVariation>;
  completedLines: Map<number, EnginePrincipalVariation>;
  options: EngineSearchOptions;
  resolve: (analysis: EngineAnalysis) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

type CoordinatorMessage =
  | { type: "ready" }
  | { type: "line"; generation: number; line: string }
  | { type: "cancelled"; generation: number; reason?: string }
  | { type: "error"; message: string }
  | { type: "progress"; progress: unknown };

export class EngineUnavailableError extends Error {
  constructor(message = "Stockfish analysis is unavailable.", options?: ErrorOptions) {
    super(message, options);
    this.name = "EngineUnavailableError";
  }
}

export class EngineCancelledError extends Error {
  constructor(message = "Stockfish analysis was cancelled.") {
    super(message);
    this.name = "EngineCancelledError";
  }
}

export function isEngineSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined"
  );
}

function finiteInteger(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validatedHistory(
  fen: string,
  history: EngineSearchOptions["history"],
): EngineSearchOptions["history"] {
  if (history === undefined) return undefined;
  if (!history || !Array.isArray(history.moves)) {
    throw new ChessDataError("Engine history must contain an initial FEN and a moves array.");
  }
  const initialFen = canonicalFen(history.initialFen);
  const board = new Chess(initialFen);
  const moves = history.moves.map((uci, index) => {
    try {
      return moveToUci(board.move(parseUciMove(uci)));
    } catch (error) {
      throw new ChessDataError(`Illegal engine history move at ply ${index + 1}: ${uci}`, {
        cause: error,
      });
    }
  });
  if (board.fen() !== fen) {
    throw new ChessDataError("Engine history does not end at the analysis FEN (including clocks).");
  }
  return { initialFen, moves };
}

function validatedSearchMoves(
  fen: string,
  searchMoves: EngineSearchOptions["searchMoves"],
): UciMove[] | undefined {
  if (searchMoves === undefined) return undefined;
  if (!Array.isArray(searchMoves) || searchMoves.length === 0) {
    throw new ChessDataError("searchMoves must be a nonempty array of legal root moves.");
  }
  const legalMoves = new Set(new Chess(fen).moves({ verbose: true }).map(moveToUci));
  return [...new Set(searchMoves.map((uci) => {
    const normalized = moveToUci(parseUciMove(uci));
    if (!legalMoves.has(normalized)) {
      throw new ChessDataError(`Illegal searchMoves root move: ${uci}`);
    }
    return normalized;
  }))];
}

function tokenNumber(tokens: string[], key: string): number | undefined {
  const index = tokens.indexOf(key);
  if (index < 0 || index + 1 >= tokens.length) return undefined;
  const value = Number(tokens[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Parses a UCI `info` line. Non-analysis lines return null. */
export function parseEngineInfoLine(line: string): EnginePrincipalVariation | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info") return null;
  const depth = tokenNumber(tokens, "depth");
  if (depth === undefined) return null;

  let score: EngineScore | undefined;
  const scoreIndex = tokens.indexOf("score");
  if (scoreIndex >= 0 && scoreIndex + 2 < tokens.length) {
    const type = tokens[scoreIndex + 1];
    const value = Number(tokens[scoreIndex + 2]);
    if ((type === "cp" || type === "mate") && Number.isFinite(value)) {
      const boundToken = tokens[scoreIndex + 3];
      score = {
        type,
        value,
        ...(boundToken === "lowerbound"
          ? { bound: "lower" as const }
          : boundToken === "upperbound"
            ? { bound: "upper" as const }
            : {}),
      };
    }
  }

  const pvIndex = tokens.indexOf("pv");
  const pv = pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [];
  const multipv = tokenNumber(tokens, "multipv") ?? 1;
  return {
    multipv,
    depth,
    ...(tokenNumber(tokens, "seldepth") !== undefined
      ? { selectiveDepth: tokenNumber(tokens, "seldepth") }
      : {}),
    ...(score ? { score } : {}),
    ...(tokenNumber(tokens, "nodes") !== undefined
      ? { nodes: tokenNumber(tokens, "nodes") }
      : {}),
    ...(tokenNumber(tokens, "nps") !== undefined ? { nps: tokenNumber(tokens, "nps") } : {}),
    ...(tokenNumber(tokens, "time") !== undefined
      ? { timeMs: tokenNumber(tokens, "time") }
      : {}),
    pv,
  };
}

function parseBestMove(line: string): { bestMove: UciMove | null; ponderMove: UciMove | null } | null {
  const match = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line.trim());
  if (!match) return null;
  return {
    bestMove: match[1] === "(none)" ? null : match[1],
    ponderMove: !match[2] || match[2] === "(none)" ? null : match[2],
  };
}

function cloneVariation(line: EnginePrincipalVariation): EnginePrincipalVariation {
  return { ...line, ...(line.score ? { score: { ...line.score } } : {}), pv: [...line.pv] };
}

function lineSnapshots(lines: Map<number, EnginePrincipalVariation>): EnginePrincipalVariation[] {
  return [...lines.values()].sort((left, right) => left.multipv - right.multipv).map(cloneVariation);
}

/**
 * Lazy, browser-only Stockfish client. At most one caller owns a search; a new
 * analyze() rejects the previous promise and the worker serializes the stop/go
 * handoff. Generation tags make all late output harmless.
 */
export class StockfishClient {
  private readonly workerUrl: string;
  private readonly engineUrl: string;
  private readonly initializationTimeoutMs: number;
  private worker: Worker | null = null;
  private currentStatus: EngineStatus = "idle";
  private generation = 0;
  private active: ActiveSearch | null = null;
  private initialization: Promise<boolean> | null = null;
  private settleInitialization: ((ready: boolean) => void) | null = null;
  private initializationTimer: ReturnType<typeof setTimeout> | null = null;
  private failureReason: string | null = null;

  constructor(options: StockfishClientOptions = {}) {
    this.workerUrl = options.workerUrl ?? assetUrl("stockfish-engine.worker.js");
    this.engineUrl = options.engineUrl ?? assetUrl("engine/stockfish-18-lite-single.js");
    this.initializationTimeoutMs = options.initializationTimeoutMs ?? 20_000;
  }

  get status(): EngineStatus {
    return this.currentStatus;
  }

  get unavailableReason(): string | null {
    return this.failureReason;
  }

  initialize(): Promise<boolean> {
    if (this.currentStatus === "ready") return Promise.resolve(true);
    if (this.currentStatus === "unavailable" || this.currentStatus === "disposed") {
      return Promise.resolve(false);
    }
    if (this.initialization) return this.initialization;
    if (!isEngineSupported()) {
      this.currentStatus = "unavailable";
      this.failureReason = "Web Workers or WebAssembly are not available.";
      return Promise.resolve(false);
    }

    this.currentStatus = "loading";
    this.initialization = new Promise<boolean>((resolve) => {
      this.settleInitialization = resolve;
      try {
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = (event: MessageEvent<CoordinatorMessage>) => {
          this.handleCoordinatorMessage(event.data);
        };
        this.worker.onerror = (event) => {
          this.markUnavailable(event.message || "Stockfish worker failed to load.");
        };
        this.initializationTimer = setTimeout(() => {
          this.markUnavailable("Stockfish did not become ready in time.");
        }, this.initializationTimeoutMs);
        this.worker.postMessage({ type: "init", engineUrl: this.engineUrl });
      } catch (error) {
        this.markUnavailable(
          error instanceof Error ? error.message : "Stockfish worker could not be created.",
        );
      }
    });
    return this.initialization;
  }

  async analyze(fen: string, options: EngineSearchOptions = {}): Promise<EngineAnalysis> {
    if (options.signal?.aborted) throw new EngineCancelledError("Stockfish analysis was aborted.");
    const normalizedFen = canonicalFen(fen);
    const depth = finiteInteger(options.depth, "depth", 1, 99);
    const moveTimeMs = finiteInteger(options.moveTimeMs, "moveTimeMs", 1, 300_000);
    const nodes = finiteInteger(options.nodes, "nodes", 1, 2_147_483_647);
    const multiPv = finiteInteger(options.multiPv ?? 1, "multiPv", 1, 10) ?? 1;
    const skillLevel = finiteInteger(options.skillLevel ?? 20, "skillLevel", 0, 20) ?? 20;
    // Validate and snapshot inputs before asynchronous initialization. Never pass
    // raw caller strings through to the worker's UCI command construction.
    const history = validatedHistory(normalizedFen, options.history);
    const searchMoves = validatedSearchMoves(normalizedFen, options.searchMoves);
    if (options.timeoutMs !== undefined) {
      finiteInteger(options.timeoutMs, "timeoutMs", 1, 600_000);
    }

    if (!(await this.initialize())) {
      throw new EngineUnavailableError(this.failureReason ?? undefined);
    }
    if (options.signal?.aborted) throw new EngineCancelledError("Stockfish analysis was aborted.");
    if (!this.worker || this.currentStatus !== "ready") {
      throw new EngineUnavailableError(this.failureReason ?? undefined);
    }

    this.stop("superseded by a newer analysis");
    const generation = ++this.generation;

    return new Promise<EngineAnalysis>((resolve, reject) => {
      const search: ActiveSearch = {
        generation,
        fen: normalizedFen,
        startedAt: performance.now(),
        lines: new Map(),
        completedLines: new Map(),
        options,
        resolve,
        reject,
      };
      if (options.timeoutMs !== undefined) {
        search.timeout = setTimeout(() => {
          if (this.active?.generation === generation) this.stop("analysis timed out");
        }, options.timeoutMs);
      }
      if (options.signal) {
        const abort = () => {
          if (this.active?.generation === generation) this.stop("analysis was aborted");
        };
        options.signal.addEventListener("abort", abort, { once: true });
        search.removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
      }
      this.active = search;
      this.worker?.postMessage({
        type: "analyze",
        generation,
        fen: normalizedFen,
        multiPv,
        skillLevel,
        ...(history ? { history } : {}),
        ...(searchMoves ? { searchMoves } : {}),
        limits: { depth, moveTimeMs, nodes },
      });
    });
  }

  stop(reason = "analysis stopped"): void {
    const search = this.active;
    if (!search) return;
    this.active = null;
    this.cleanupSearch(search);
    this.worker?.postMessage({ type: "stop", generation: search.generation, reason });
    search.reject(new EngineCancelledError(reason));
  }

  dispose(): void {
    if (this.currentStatus === "disposed") return;
    this.stop("engine disposed");
    this.worker?.postMessage({ type: "dispose" });
    this.worker?.terminate();
    this.worker = null;
    this.currentStatus = "disposed";
    this.failureReason = "The engine client was disposed.";
    this.finishInitialization(false);
  }

  private handleCoordinatorMessage(message: CoordinatorMessage): void {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      this.currentStatus = "ready";
      this.failureReason = null;
      this.finishInitialization(true);
      return;
    }
    if (message.type === "error") {
      this.markUnavailable(message.message);
      return;
    }
    if (message.type === "cancelled") {
      if (this.active?.generation === message.generation) {
        this.stop(message.reason ?? "analysis cancelled by worker");
      }
      return;
    }
    if (message.type !== "line") return;

    const search = this.active;
    if (!search || search.generation !== message.generation) return;
    const info = parseEngineInfoLine(message.line);
    if (info) {
      // Stockfish also emits depth-bearing progress records (currmove, nodes,
      // etc.) without a scored PV. They are not a replacement analysis and
      // must not erase the last usable line when a fixed budget ends mid-depth.
      // Keep score bounds intact: a later fail-high/low is not an exact score.
      if (info.score && info.pv.length > 0) {
        search.lines.set(info.multipv, info);
        // Keep the actual last completed iteration separately. A consumer may
        // use it only after checking its root, rather than stripping a newer
        // bound or attaching an old exact score to the new best move.
        if (!info.score.bound) search.completedLines.set(info.multipv, info);
      }
      if (search.options.onInfo) {
        try {
          search.options.onInfo(cloneVariation(info), lineSnapshots(search.lines));
        } catch {
          // Consumer rendering errors must not corrupt the engine protocol.
        }
      }
      return;
    }

    const best = parseBestMove(message.line);
    if (!best) return;
    this.active = null;
    this.cleanupSearch(search);
    search.resolve({
      generation: search.generation,
      fen: search.fen,
      perspective: search.fen.split(" ")[1] as "w" | "b",
      bestMove: best.bestMove,
      ponderMove: best.ponderMove,
      lines: lineSnapshots(search.lines),
      completedLines: lineSnapshots(search.completedLines),
      elapsedMs: Math.max(0, performance.now() - search.startedAt),
    });
  }

  private cleanupSearch(search: ActiveSearch): void {
    if (search.timeout) clearTimeout(search.timeout);
    search.removeAbortListener?.();
  }

  private finishInitialization(ready: boolean): void {
    if (this.initializationTimer) clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.settleInitialization?.(ready);
    this.settleInitialization = null;
  }

  private markUnavailable(message: string): void {
    if (this.currentStatus === "disposed") return;
    this.currentStatus = "unavailable";
    this.failureReason = message;
    const search = this.active;
    this.active = null;
    if (search) {
      this.cleanupSearch(search);
      search.reject(new EngineUnavailableError(message));
    }
    this.worker?.terminate();
    this.worker = null;
    this.finishInitialization(false);
  }
}
