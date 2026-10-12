import { Chess } from "chess.js";

import { parseUciMove } from "./chess";
import type { EngineAnalysis, EnginePrincipalVariation } from "./types";

/** White is always positive, regardless of the learner or board orientation. */
export type WhiteEvaluation =
  | { kind: "cp"; value: number }
  | { kind: "mate"; value: number; winner: "w" | "b" }
  | { kind: "draw"; value: 0 };

function exactRootLine(
  lines: readonly EnginePrincipalVariation[] | undefined,
  bestMove: string,
): EnginePrincipalVariation | undefined {
  return lines?.find((line) => line.multipv === 1
    && line.pv[0] === bestMove
    && line.score !== undefined
    && !line.score.bound
    && Number.isFinite(line.score.value)
    && (line.score.type === "cp"
      || (line.score.type === "mate" && Number.isInteger(line.score.value) && line.score.value !== 0)));
}

/**
 * Read the exact score for this analysis's final root move, preferring its last
 * completed iteration. Never attach a stale root's score to a new best move or
 * reinterpret an unfinished aspiration bound as an exact evaluation.
 *
 * The caller must also match analysis.fen/generation to its displayed position.
 * Actual terminal positions should use terminalEvaluation with full history.
 */
export function evaluationFromAnalysis(
  analysis: EngineAnalysis | null | undefined,
): WhiteEvaluation | null {
  if (!analysis?.bestMove) return null;
  let root: Chess;
  try {
    root = new Chess(analysis.fen);
    if (root.turn() !== analysis.perspective) return null;
    root.move(parseUciMove(analysis.bestMove));
  } catch {
    return null;
  }
  const line = exactRootLine(analysis.completedLines, analysis.bestMove)
    ?? exactRootLine(analysis.lines, analysis.bestMove);
  if (!line?.score) return null;
  const value = line.score.value * (analysis.perspective === "w" ? 1 : -1);
  if (line.score.type === "cp") return { kind: "cp", value: value === 0 ? 0 : value };
  return { kind: "mate", value, winner: value > 0 ? "w" : "b" };
}

/** Uses the supplied game's history, so threefold repetition is not lost to FEN. */
export function terminalEvaluation(board: Chess): WhiteEvaluation | null {
  if (board.isCheckmate()) {
    const winner = board.turn() === "w" ? "b" : "w";
    // The winner remains explicit even if JSON serialization loses negative zero.
    return { kind: "mate", value: winner === "w" ? 0 : -0, winner };
  }
  if (board.isDraw()) return { kind: "draw", value: 0 };
  return null;
}

/** Unknown is deliberately not formatted as an equal position. */
export function formatEvaluation(evaluation: WhiteEvaluation | null): string {
  if (!evaluation || !Number.isFinite(evaluation.value)) return "—";
  if (evaluation.kind === "mate") return `${evaluation.winner === "w" ? "+" : "-"}M${Math.abs(evaluation.value)}`;
  if (evaluation.kind === "draw") return "0.00";
  const rounded = Math.round(evaluation.value) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded === 0 ? "0.00" : rounded.toFixed(2)}`;
}

/**
 * White's visual bar share, NOT a win probability. The smooth symmetric scale
 * leaves both colours visible for finite cp scores; only known mate fills it.
 * A null result is unknown, not an implied 50/50 evaluation.
 */
export function whiteShare(evaluation: WhiteEvaluation | null): number | null {
  if (!evaluation || !Number.isFinite(evaluation.value)) return null;
  if (evaluation.kind === "mate") return evaluation.winner === "w" ? 100 : 0;
  if (evaluation.kind === "draw") return 50;
  return Math.max(4, Math.min(96, 50 + 46 * Math.tanh(evaluation.value / 400)));
}
