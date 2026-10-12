import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

import { canonicalEpd, canonicalFen, moveToUci, parseUciMove } from "./chess";
import { openingRecallPrompts, type OpeningFamily } from "./curriculum";
import { EngineCancelledError, type StockfishClient } from "./engine";
import type { EngineAnalysis, EngineScore, EngineSearchOptions } from "./types";

export type MoveClassification =
  | "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder" | "unrated";

export interface CoachingEvidence {
  kind: "checkmate" | "stalemate" | "material" | "knight-fork" | "authored";
  text: string;
  squares: string[];
}

/** Serializable: neither chess.js instances nor browser objects enter saved games. */
export interface MoveAssessment {
  playedMove: string;
  playedSan: string;
  bestMove: string;
  bestSan: string;
  classification: MoveClassification;
  title: string;
  explanation: string;
  confidence: "verified" | "limited";
  bestLine: string[];
  playedLine: string[];
  beforeFen: string;
  lossCp?: number;
  bestScore?: EngineScore;
  playedScore?: EngineScore;
  authoredContext?: string;
  strategicContext?: string;
  evidence: CoachingEvidence[];
}

export interface AssessMoveInput {
  initialFen: string;
  /** Complete game history BEFORE the learner's move, in UCI notation. */
  moves: string[];
  playedMove: string;
  family: OpeningFamily;
  signal?: AbortSignal;
}

export interface MoveQuality {
  classification: MoveClassification;
  lossCp?: number;
}

/**
 * Our own approximate labels, not Chess.com's expected-points model. Scores
 * must share the mover's perspective. Losing positions are not bad moves.
 * Mate scores remain mate scores: no invented centipawn conversion is used.
 */
export function classifyMove(
  best: EngineScore | undefined,
  played: EngineScore | undefined,
  isEngineBestMove = false,
): MoveQuality {
  if (!best || !played || best.bound || played.bound
    || !Number.isFinite(best.value) || !Number.isFinite(played.value)) {
    return { classification: "unrated" };
  }
  if (isEngineBestMove) return { classification: "best", ...(best.type === "cp" && played.type === "cp" ? { lossCp: 0 } : {}) };
  if (best.type === "cp" && played.type === "cp") {
    // Independent short searches occasionally disagree; do not call that a
    // brilliant move, or fabricate an exact loss from an unstable comparison.
    if (played.value - best.value > 30) return { classification: "unrated" };
    const lossCp = Math.max(0, best.value - played.value);
    const classification: MoveClassification = lossCp <= 15 ? "excellent"
      : lossCp <= 50 ? "good"
        : lossCp <= 100 ? "inaccuracy"
          : lossCp <= 200 ? "mistake" : "blunder";
    return { classification, lossCp };
  }
  if (best.type === "mate" && played.type === "mate") {
    if (best.value > 0 && played.value < 0) return { classification: "blunder" };
    if (best.value > 0 && played.value > 0) return { classification: "excellent" };
    if (best.value < 0 && played.value < 0) return { classification: "good" };
    return { classification: "unrated" };
  }
  if (best.type === "cp" && played.type === "mate") {
    if (played.value < 0 && best.value >= -100) return { classification: "blunder" };
    if (played.value < 0 && best.value > -300) return { classification: "mistake" };
    // An already deeply lost position reaching mate is not automatically a new
    // blunder. A restricted search finding a win absent in the main search is
    // also not enough to establish a stable classification.
    return { classification: "unrated" };
  }
  if (best.type === "mate" && best.value > 0 && played.type === "cp") {
    // Losing a demonstrated mate while keeping a large advantage need not
    // lose the game; reserve the harsh labels for a real outcome change.
    return { classification: played.value < -100 ? "blunder" : played.value <= 100 ? "mistake" : "inaccuracy" };
  }
  return { classification: "unrated" };
}

const PIECE_VALUES: Record<PieceSymbol, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const PIECE_NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

function materialBalance(board: Chess, learner: Color): number {
  return board.board().flat().reduce((sum, piece) => sum + (piece ? PIECE_VALUES[piece.type] * (piece.color === learner ? 1 : -1) : 0), 0);
}

export interface ReplayedCoachingLine {
  legal: boolean;
  moves: Move[];
  fens: string[];
  san: string[];
  materialChange: number;
  materialSettled: boolean;
  checkmated: Color | null;
  stalemate: boolean;
}

/** Replay first, explain second. A truncated exchange is not a material verdict. */
export function replayCoachingLine(fen: string, line: readonly string[]): ReplayedCoachingLine {
  const board = new Chess(canonicalFen(fen));
  const learner = board.turn();
  const originalMaterial = materialBalance(board, learner);
  const moves: Move[] = [];
  const fens: string[] = [board.fen()];
  let lastMaterialChange = -1;
  try {
    for (const uci of line) {
      const move = board.move(parseUciMove(uci));
      moves.push(move);
      fens.push(board.fen());
      if (move.captured || move.promotion) lastMaterialChange = moves.length - 1;
    }
  } catch {
    return { legal: false, moves: [], fens: [canonicalFen(fen)], san: [], materialChange: 0, materialSettled: false, checkmated: null, stalemate: false };
  }
  return {
    legal: true,
    moves,
    fens,
    san: moves.map((move) => move.san),
    materialChange: materialBalance(board, learner) - originalMaterial,
    // Require two subsequent non-material-changing plies. This deliberately
    // declines many explanations rather than treating a pending recapture or
    // temporary sacrifice as a demonstrated loss.
    materialSettled: lastMaterialChange >= 0 && !board.isCheck()
      && moves.length - lastMaterialChange - 1 >= 2,
    checkmated: board.isCheckmate() ? board.turn() : null,
    stalemate: board.isStalemate(),
  };
}

/** Authored prose is usable ONLY for that exact position and that exact move. */
export function authoredMoveContext(fen: string, move: string, family: OpeningFamily): string | undefined {
  const key = canonicalEpd(fen);
  return openingRecallPrompts.find((prompt) => prompt.family === family
    && canonicalEpd(prompt.fen) === key
    && (prompt.acceptedMoves as readonly string[] | undefined)?.includes(move))?.explanation;
}

/** Conditional study guidance; never masquerades as the cause of an engine score. */
export function openingStrategicContext(fen: string, family: OpeningFamily): string | undefined {
  const board = new Chess(canonicalFen(fen));
  const isPawn = (square: Square, color: Color) => board.get(square)?.type === "p" && board.get(square)?.color === color;
  if (family === "kid" && board.turn() === "b" && isPawn("d5", "w") && isPawn("e5", "b")) {
    return "Structure reminder, not the reason for the move rating: the d5/e5 pawn chains point toward a closed-centre King's Indian plan. Before ...f5, check support for e5, king safety, and White's queenside counterplay. Thematic does not mean timely.";
  }
  if ((family === "pirc" || family === "kid") && board.turn() === "b" && isPawn("e4", "w") && isPawn("d4", "w")) {
    return "Structure reminder, not the reason for the move rating: White still has an e4-d4 pawn centre. Compare the preparation for ...c5 and ...e5 before choosing a wing attack; calculate the central replies rather than playing the setup automatically.";
  }
  if (family === "kia" && board.turn() === "w" && isPawn("e4", "w") && isPawn("e6", "b")) {
    return "Structure reminder, not the reason for the move rating: against ...e6, an eventual e5 can gain KIA space, but first check d5/f5 control, the f3-knight's route, and whether Black can open the centre. A kingside attack is not automatic.";
  }
  if (family === "kia" && board.turn() === "w" && isPawn("d5", "b")) {
    return "Structure reminder, not the reason for the move rating: Black's d5 pawn asks you to compare an e4 challenge, c4 pressure, and quiet development. Choose from the actual central tension; do not assume every KIA position calls for e5 or a kingside attack.";
  }
  return undefined;
}

function knightAttacks(from: Square, to: Square): boolean {
  const file = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rank = Math.abs(Number(from[1]) - Number(to[1]));
  return file * rank === 2;
}

function verifiedKnightFork(replay: ReplayedCoachingLine, learner: Color): CoachingEvidence | undefined {
  const fork = replay.moves[1];
  const capture = replay.moves[3];
  if (!replay.materialSettled || replay.materialChange >= 0
    || fork?.piece !== "n" || fork.color === learner
    || capture?.piece !== "n" || capture.from !== fork.to
    || !capture.captured || !["r", "q"].includes(capture.captured)) return undefined;
  const forkBoard = new Chess(replay.fens[2]);
  const king = forkBoard.board().flat().find((piece) => piece?.type === "k" && piece.color === learner);
  if (!king || !knightAttacks(fork.to, king.square) || !knightAttacks(fork.to, capture.to)) return undefined;
  const target = forkBoard.get(capture.to);
  if (!target || target.color !== learner || target.type !== capture.captured) return undefined;
  return {
    kind: "knight-fork",
    text: `In the displayed continuation, ${fork.san} forks your king on ${king.square} and ${PIECE_NAMES[target.type]} on ${capture.to}. After the king responds, ${capture.san} captures the ${PIECE_NAMES[target.type]}.`,
    squares: [fork.to, king.square, capture.to],
  };
}

function settledForComparison(replay: ReplayedCoachingLine): boolean {
  if (!replay.legal || replay.moves.length < 3) return false;
  const endpoint = new Chess(replay.fens.at(-1)!);
  return !endpoint.isCheck() && (replay.materialSettled
    || !replay.moves.some((move) => move.captured || move.promotion));
}

interface EarlyMaterialComparison {
  plies: number;
  played: ReplayedCoachingLine;
  best: ReplayedCoachingLine;
}

/**
 * A distant, unrelated capture can leave the final PV unsettled even though
 * an immediate lost piece is already visible. Compare BOTH branches at the
 * same early, quiet horizon instead of discarding that concrete evidence.
 */
function earlyMaterialComparison(
  fen: string,
  playedLine: readonly string[],
  bestLine: readonly string[],
  playedFull: ReplayedCoachingLine,
  bestFull: ReplayedCoachingLine,
): EarlyMaterialComparison | undefined {
  if (!playedFull.legal || !bestFull.legal) return undefined;
  const initial = new Chess(fen);
  const learner = initial.turn();
  const originalMaterial = materialBalance(initial, learner);
  for (let plies = 3; plies <= Math.min(8, playedLine.length, bestLine.length); plies++) {
    const played = replayCoachingLine(fen, playedLine.slice(0, plies));
    const best = replayCoachingLine(fen, bestLine.slice(0, plies));
    if (!settledForComparison(played) || !settledForComparison(best)
      || !played.materialSettled || played.materialChange > -100
      || best.materialChange <= played.materialChange) continue;
    // Do not cherry-pick a sacrifice recovered later. Compare later SETTLED
    // checkpoints: a capture can briefly balance the books immediately before
    // its recapture, which is not a recovered sacrifice. A nonnegative final
    // endpoint still vetoes the explanation, even if that last exchange has
    // not yet settled, because the available continuation cannot confirm it.
    let lossPersists = playedFull.materialChange <= -100;
    let lastMaterialChange = -1;
    for (let index = 0; lossPersists && index < playedFull.moves.length; index++) {
      const move = playedFull.moves[index];
      if (move.captured || move.promotion) lastMaterialChange = index;
      if (index + 1 <= plies || lastMaterialChange < 0 || index - lastMaterialChange < 2) continue;
      const endpoint = new Chess(playedFull.fens[index + 1]);
      if (!endpoint.isCheck() && materialBalance(endpoint, learner) - originalMaterial > -100) lossPersists = false;
    }
    if (lossPersists) return { plies, played, best };
  }
  return undefined;
}

function describeImmediateCapture(replay: ReplayedCoachingLine, learner: Color): string {
  const first = replay.moves[0];
  const reply = replay.moves[1];
  const opponent = learner === "w" ? "Black" : "White";
  if (reply?.captured && reply.color !== learner && reply.to === first?.to
    && reply.captured === (first.promotion ?? first.piece)) {
    const piece = PIECE_NAMES[reply.captured];
    const exchange = first.captured && PIECE_VALUES[reply.captured] > PIECE_VALUES[first.captured]
      ? ` In this exchange you trade your ${piece} for a ${PIECE_NAMES[first.captured]}.` : "";
    return `Your ${piece} on ${reply.to} is captured by ${opponent}'s ${reply.san}.${exchange}`;
  }
  const capture = replay.moves.find((move) => move.color !== learner && move.captured);
  return capture?.captured
    ? `${opponent} plays ${capture.san}, capturing your ${PIECE_NAMES[capture.captured]} on ${capture.to}.`
    : "";
}

export interface ExplainMoveInput {
  beforeFen: string;
  playedMove: string;
  bestMove: string;
  bestLine: string[];
  playedLine: string[];
  classification: MoveClassification;
  family: OpeningFamily;
  bestScore?: EngineScore;
  playedScore?: EngineScore;
}

export interface MoveExplanation {
  title: string;
  explanation: string;
  confidence: "verified" | "limited";
  evidence: CoachingEvidence[];
  authoredContext?: string;
  strategicContext?: string;
}

const CLASSIFICATION_LABELS: Record<MoveClassification, string> = {
  best: "Best", excellent: "Excellent", good: "Good", inaccuracy: "Inaccuracy",
  mistake: "Mistake", blunder: "Blunder", unrated: "Analysis uncertain",
};

export function explainMove(input: ExplainMoveInput): MoveExplanation {
  const board = new Chess(canonicalFen(input.beforeFen));
  const learner = board.turn();
  const bestSan = board.move(parseUciMove(input.bestMove)).san;
  board.undo();
  board.move(parseUciMove(input.playedMove));
  const bestReplay = replayCoachingLine(input.beforeFen, input.bestLine);
  const playedReplay = replayCoachingLine(input.beforeFen, input.playedLine);
  const evidence: CoachingEvidence[] = [];
  const label = CLASSIFICATION_LABELS[input.classification];
  const bad = ["inaccuracy", "mistake", "blunder"].includes(input.classification);
  const earlyMaterial = bad && (!settledForComparison(playedReplay) || !settledForComparison(bestReplay))
    ? earlyMaterialComparison(input.beforeFen, input.playedLine, input.bestLine, playedReplay, bestReplay)
    : undefined;
  const authoredPlayed = authoredMoveContext(input.beforeFen, input.playedMove, input.family);
  const authoredBest = authoredMoveContext(input.beforeFen, input.bestMove, input.family);
  const authoredContext = authoredPlayed
    ? `Repertoire note for your move: ${authoredPlayed}`
    : authoredBest ? `Repertoire note for ${bestSan}: ${authoredBest}` : undefined;
  const strategicContext = openingStrategicContext(input.beforeFen, input.family);
  let title = label;
  let explanation = input.classification === "unrated"
    ? "The bounded searches did not produce a stable, comparable score. No reliable move-quality verdict is available; you can still inspect the legal continuations."
    : input.playedMove === input.bestMove
      ? "Your move matches the engine's first choice at this analysis budget. No clear tactical reason has been verified, so the coach will not invent a positional explanation."
      : bad
        ? `The engine prefers ${bestSan}, but no concrete cause has been verified from these short continuations. Compare both lines; the score alone is not an explanation.`
        : `Your move is a sound alternative within this bounded analysis. ${bestSan} is the engine's first choice, but differing from it or from the repertoire is not automatically a mistake. No clear tactical reason for the preference has been verified.`;

  if (board.isCheckmate()) {
    title = `${label} — checkmate`;
    explanation = "Your move gives checkmate: the king is in check and the opponent has no legal reply. The game is won; there is no need to compare centipawn scores.";
    evidence.push({ kind: "checkmate", text: explanation, squares: [input.playedMove.slice(2, 4)] });
  } else if (board.isStalemate()) {
    title = `${label} — stalemate`;
    explanation = `Your move ends the game by stalemate: the opponent has no legal move but is not in check. That is a draw.${bad ? ` The engine's alternative, ${bestSan}, retains better chances.` : " A draw can be a good result when defending."}`;
    evidence.push({ kind: "stalemate", text: explanation, squares: [] });
  } else if (bad && playedReplay.legal && playedReplay.checkmated === learner) {
    title = `${label} — allows a mating line`;
    explanation = `Your move allows the displayed continuation to end in checkmate against you. Replay it to see the checks and the final position with no legal escape. ${bestSan} is the engine's stronger alternative.`;
    evidence.push({ kind: "checkmate", text: explanation, squares: [playedReplay.moves.at(-1)!.to] });
  } else if (bad && bestReplay.legal && bestReplay.checkmated && bestReplay.checkmated !== learner) {
    title = `${label} — missed a mating line`;
    explanation = `${bestSan} starts the engine's displayed mating continuation. Replay the checks to see how that line ends in checkmate; your move does not retain the same demonstrated mating sequence.`;
    evidence.push({ kind: "checkmate", text: explanation, squares: [bestReplay.moves.at(-1)!.to] });
  } else if (earlyMaterial) {
    const points = Math.abs(earlyMaterial.played.materialChange) / 100;
    const concreteCapture = describeImmediateCapture(earlyMaterial.played, learner);
    title = `${label} — material lost in the line`;
    explanation = `${concreteCapture ? `${concreteCapture} ` : ""}In the first ${earlyMaterial.plies} plies (individual moves) of this displayed continuation, your material balance falls by ${points} pawn-value point${points === 1 ? "" : "s"} after the captures and recaptures. Over the same ${earlyMaterial.plies} plies, the alternative starting with ${bestSan} does not show that loss. This describes the replayed exchange, not a rule that every sacrifice is bad.`;
    evidence.push({ kind: "material", text: explanation, squares: earlyMaterial.played.moves.filter((move) => move.captured).map((move) => move.to).slice(0, 8) });
  } else if (bad && settledForComparison(playedReplay) && settledForComparison(bestReplay) && playedReplay.materialSettled
    && playedReplay.materialChange <= -100
    && bestReplay.materialChange > playedReplay.materialChange) {
    const fork = verifiedKnightFork(playedReplay, learner);
    const points = Math.abs(playedReplay.materialChange) / 100;
    title = `${label} — ${fork ? "allows a knight fork" : "material lost in the line"}`;
    const concreteCapture = fork?.text ?? describeImmediateCapture(playedReplay, learner);
    explanation = `${concreteCapture ? `${concreteCapture} ` : ""}After the captures and recaptures in the displayed line, your material balance has fallen by ${points} pawn-value point${points === 1 ? "" : "s"}. The alternative line starting with ${bestSan} does not show the same material loss. This describes these continuations, not a rule that every sacrifice is bad.`;
    if (fork) evidence.push(fork);
    evidence.push({ kind: "material", text: `Material change in the displayed line: ${playedReplay.materialChange / 100} pawn-value points (pawn 1, knight/bishop 3, rook 5, queen 9).`, squares: playedReplay.moves.filter((move) => move.captured).map((move) => move.to).slice(0, 8) });
  } else if (bad && settledForComparison(bestReplay) && settledForComparison(playedReplay) && bestReplay.materialSettled
    && bestReplay.materialChange >= 100 && bestReplay.materialChange > playedReplay.materialChange) {
    title = `${label} — missed material in the line`;
    explanation = `The continuation starting with ${bestSan} improves your material balance by ${bestReplay.materialChange / 100} pawn-value points after the displayed captures and recaptures. Your line does not achieve the same gain. Replay both lines to compare what can be taken safely in those continuations.`;
    evidence.push({ kind: "material", text: explanation, squares: bestReplay.moves.filter((move) => move.captured).map((move) => move.to).slice(0, 8) });
  } else if (!bad && input.classification !== "unrated" && playedReplay.legal
    && playedReplay.checkmated && playedReplay.checkmated !== learner) {
    title = `${label} — a mating continuation`;
    explanation = "Your move leads to checkmate in the displayed engine continuation. Replay the line to see the checks and the final position where the opponent has no legal escape.";
    evidence.push({ kind: "checkmate", text: explanation, squares: [playedReplay.moves.at(-1)!.to] });
  } else if (!bad && input.classification !== "unrated" && playedReplay.legal
    && playedReplay.materialSettled && playedReplay.materialChange >= 100) {
    title = `${label} — material gained in the line`;
    explanation = `After the captures and recaptures in the displayed continuation, your material balance improves by ${playedReplay.materialChange / 100} pawn-value points. That is a concrete benefit you can replay on the board. Material is one part of the position; the move rating also uses the engine's overall evaluation.`;
    evidence.push({ kind: "material", text: explanation, squares: playedReplay.moves.filter((move) => move.captured).map((move) => move.to).slice(0, 8) });
  } else if (!bad && input.classification !== "unrated" && authoredPlayed) {
    title = `${label} — repertoire idea`;
    explanation = `In this exact repertoire position: ${authoredPlayed} The move rating is based on engine comparison, not on matching a memorized answer.`;
    evidence.push({ kind: "authored", text: authoredPlayed, squares: [input.playedMove.slice(0, 2), input.playedMove.slice(2, 4)] });
  } else if (input.bestScore?.type === "mate" && input.bestScore.value < 0
    && input.playedScore?.type === "mate" && input.playedScore.value < 0) {
    explanation = "Both searches already report a forced mate against you. A negative score in a lost position does not make every defensive move a new blunder. Compare the legal lines to find the most resistant defense.";
  }

  // An engine's exact mate score is useful even when the PV stops before the
  // mating position. Attribute it explicitly; a truncated line is not replay
  // proof and must never receive the 'verified' evidence badge.
  if (evidence.length === 0) {
    const playedMate = input.playedScore?.type === "mate" && !input.playedScore.bound
      && Number.isInteger(input.playedScore.value) && input.playedScore.value !== 0
      ? input.playedScore.value : undefined;
    const bestMate = input.bestScore?.type === "mate" && !input.bestScore.bound
      && Number.isInteger(input.bestScore.value) && input.bestScore.value !== 0
      ? input.bestScore.value : undefined;
    if (playedMate !== undefined && !(playedMate < 0 && bestMate !== undefined && bestMate < 0)) {
      explanation = `The engine reports a forced mate in ${Math.abs(playedMate)} ${playedMate > 0 ? "for you" : "against you"} after your move. The displayed continuation does not reach the mating position, so this is an engine report, not a fully replay-verified explanation.${playedMate < 0 && bad ? ` Compare ${bestSan}, its stronger alternative.` : ""}`;
    } else if (bestMate !== undefined && bestMate > 0 && bad) {
      explanation = `The engine reports a forced mate in ${bestMate} after ${bestSan}. The displayed continuation stops before checkmate, so the coach cannot yet show the complete mating mechanism. This is an engine report, not a fully replay-verified explanation.`;
    }
  }

  return { title, explanation, confidence: evidence.length ? "verified" : "limited", evidence, ...(authoredContext ? { authoredContext } : {}), ...(strategicContext ? { strategicContext } : {}) };
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EngineCancelledError("Move coaching was aborted.");
}

function readAnalysis(analysis: EngineAnalysis, fen: string, expectedRoot?: string): { move?: string; score?: EngineScore; line: string[] } {
  const root = new Chess(fen);
  if (canonicalFen(analysis.fen) !== canonicalFen(fen) || analysis.perspective !== root.turn()) return { line: [] };
  const move = expectedRoot ?? analysis.bestMove ?? undefined;
  if (!move) return { line: [] };
  try { root.move(parseUciMove(move)); } catch { return { line: [] }; }
  if (expectedRoot && analysis.bestMove !== expectedRoot) return { move, line: [move] };
  const variation = [...analysis.lines].sort((a, b) => a.multipv - b.multipv)
    .find((line) => line.pv[0] === move);
  if (!variation || !replayCoachingLine(fen, variation.pv).legal) return { move, line: [move] };
  if (variation.score?.bound) {
    // Node/time budgets can stop in the next iteration's aspiration search.
    // That bound is NOT an exact score. Use the separately retained last
    // completed iteration only when it evaluated the SAME actual root move.
    const completed = analysis.completedLines?.find((line) => line.pv[0] === move
      && line.score && !line.score.bound && replayCoachingLine(fen, line.pv).legal);
    if (completed?.score) {
      const prior = completed.score;
      const latest = variation.score;
      const contradicted = prior.type !== latest.type
        || (prior.type === "cp" && latest.type === "cp"
          && (latest.bound === "lower" ? latest.value - prior.value > 50 : prior.value - latest.value > 50))
        || (prior.type === "mate" && latest.type === "mate" && prior.value !== latest.value);
      // A new bound that excludes the previous value by a meaningful margin
      // is evidence of instability. Keep it bounded so assessMove retries and
      // remains unrated if the contradiction persists.
      if (!contradicted) return { move, score: prior, line: completed.pv.slice(0, 64) };
    }
  }
  return { move, score: variation.score, line: variation.pv.slice(0, 64) };
}

/** Strong coaching is intentionally independent from the opponent's skill. */
export async function assessMove(engine: Pick<StockfishClient, "analyze">, input: AssessMoveInput): Promise<MoveAssessment> {
  aborted(input.signal);
  const board = new Chess(canonicalFen(input.initialFen));
  for (const move of input.moves) board.move(parseUciMove(move));
  if (board.isGameOver()) throw new Error("Cannot assess a move after the game is over.");
  const beforeFen = board.fen();
  const played = board.move(parseUciMove(input.playedMove));
  const playedMove = moveToUci(played);
  const base = { playedMove, playedSan: played.san, beforeFen };

  if (board.isCheckmate()) {
    const explanation = explainMove({ beforeFen, playedMove, bestMove: playedMove, bestLine: [playedMove], playedLine: [playedMove], classification: "best", family: input.family });
    return { ...base, bestMove: playedMove, bestSan: played.san, classification: "best", bestLine: [playedMove], playedLine: [playedMove], ...explanation };
  }

  const history = { initialFen: canonicalFen(input.initialFen), moves: [...input.moves] };
  async function compare(nodes: number, moveTimeMs: number) {
    const options: EngineSearchOptions = { history, nodes, moveTimeMs, multiPv: 1, skillLevel: 20, signal: input.signal, timeoutMs: 20_000 };
    aborted(input.signal);
    const best = readAnalysis(await engine.analyze(beforeFen, options), beforeFen);
    aborted(input.signal);
    // Restrict the ROOT search, rather than negating a shallower child search.
    // This also evaluates learner moves absent from the engine's top lines.
    const chosen = readAnalysis(await engine.analyze(beforeFen, { ...options, searchMoves: [playedMove] }), beforeFen, playedMove);
    aborted(input.signal);
    return { best, chosen };
  }
  let { best, chosen } = await compare(60_000, 1_500);
  let quality = classifyMove(best.score, chosen.score, best.move === playedMove);
  const needsConfirmation = quality.classification === "mistake" || quality.classification === "blunder"
    || quality.classification === "unrated" || best.score?.type !== chosen.score?.type;
  if (needsConfirmation) {
    ({ best, chosen } = await compare(120_000, 2_500));
    quality = classifyMove(best.score, chosen.score, best.move === playedMove);
  }
  const bestMove = best.move ?? playedMove;
  const bestBoard = new Chess(beforeFen);
  const bestSan = bestBoard.move(parseUciMove(bestMove)).san;
  const bestLine = best.line.length ? best.line : [bestMove];
  const playedLine = chosen.line.length ? chosen.line : [playedMove];
  const explanation = explainMove({ beforeFen, playedMove, bestMove, bestLine, playedLine, classification: quality.classification, family: input.family, bestScore: best.score, playedScore: chosen.score });
  return {
    ...base, ...quality, ...explanation, bestMove, bestSan, bestLine, playedLine,
    ...(best.score ? { bestScore: best.score } : {}), ...(chosen.score ? { playedScore: chosen.score } : {}),
  };
}
