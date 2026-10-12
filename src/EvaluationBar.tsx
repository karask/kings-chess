import { Chess } from "chess.js";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { parseUciMove } from "../lib/chess";
import { StockfishClient } from "../lib/engine";
import { evaluationFromAnalysis, formatEvaluation, terminalEvaluation, whiteShare, type WhiteEvaluation } from "../lib/evaluation";
import type { EngineSearchOptions } from "../lib/types";

type History = NonNullable<EngineSearchOptions["history"]>;

/** A position-only score: never reuse a previous position's evaluation. */
export function EvaluationBar({ history, orientation, enabled, hidden, generation, engineRef, searchControllerRef }: {
  history: History;
  orientation: "white" | "black";
  enabled: boolean;
  hidden: boolean;
  /** Restart after an external cancellation even if the position is unchanged. */
  generation: number;
  engineRef: RefObject<StockfishClient | null>;
  searchControllerRef: RefObject<AbortController | null>;
}) {
  const positionKey = JSON.stringify(history);
  const position = useMemo(() => {
    const snapshot = JSON.parse(positionKey) as History;
    const board = new Chess(snapshot.initialFen);
    for (const move of snapshot.moves) board.move(parseUciMove(move));
    return { board, history: snapshot, terminal: terminalEvaluation(board) };
  }, [positionKey]);
  const [answer, setAnswer] = useState<{ key: string; evaluation: WhiteEvaluation | null } | null>(null);

  useEffect(() => {
    // Coaching, opponent replies and candidate checks own the same worker first.
    // This idle search never blocks a learner from moving.
    if (!enabled || hidden || position.terminal) return;
    const controller = new AbortController();
    searchControllerRef.current = controller;
    engineRef.current ??= new StockfishClient();
    void engineRef.current.analyze(position.board.fen(), {
      history: position.history, skillLevel: 20, nodes: 35_000, moveTimeMs: 700,
      timeoutMs: 25_000, signal: controller.signal,
    }).then((analysis) => {
      if (!controller.signal.aborted) setAnswer({ key: positionKey, evaluation: evaluationFromAnalysis(analysis) });
    }).catch(() => {
      if (!controller.signal.aborted) setAnswer({ key: positionKey, evaluation: null });
    });
    return () => {
      controller.abort();
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
    };
  }, [enabled, hidden, generation, position, positionKey, engineRef, searchControllerRef]);

  const current = answer?.key === positionKey ? answer : null;
  const evaluation = hidden ? null : position.terminal ?? current?.evaluation ?? null;
  const share = whiteShare(evaluation);
  const score = evaluation ? formatEvaluation(evaluation) : !hidden && !current ? "…" : "—";
  const favorsBlack = evaluation?.kind === "mate" ? evaluation.winner === "b" : (evaluation?.value ?? 0) < 0;
  const scoreAtTop = evaluation && (orientation === "white" ? favorsBlack : !favorsBlack);
  const meaning = hidden ? "Evaluation hidden until the game ends." : evaluation ? `Position evaluation ${score}. Positive favors White; negative favors Black.` : current ? "Evaluation unavailable for this position." : "Waiting for this position’s evaluation.";
  const description = `${meaning} M means forced mate in that many moves. The bar is an engine estimate, not a win probability.`;

  return <div className={`evaluation-bar ${orientation === "black" ? "evaluation-flipped" : ""} ${evaluation ? "" : "evaluation-pending"}`} role="img" aria-label={meaning} title={description}>
    <div className="evaluation-white" style={{ height: `${share ?? 50}%` }} />
    <span className={`evaluation-score ${scoreAtTop ? "evaluation-score-top" : ""} ${evaluation && favorsBlack ? "evaluation-score-black" : ""}`}>{score}</span>
  </div>;
}
