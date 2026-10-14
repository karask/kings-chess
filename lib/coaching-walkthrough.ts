import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

import { canonicalFen, moveToUci } from "./chess";
import { replayCoachingLine, type CoachingEvidence, type MoveAssessment } from "./coaching";

export type CoachingLine = "played" | "best";

export interface CoachingWalkthroughStep {
  /** Zero is the position before the learner's decision. */
  ply: number;
  fen: string;
  title: string;
  text: string;
  squares: string[];
  move?: string;
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

function squareList(squares: readonly string[]): string[] {
  return [...new Set(squares.filter((square) => /^[a-h][1-8]$/.test(square)))];
}

function colorName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

function owner(color: Color, learner: Color, capitalized = false): string {
  return color === learner ? (capitalized ? "Your" : "your") : `${colorName(color)}'s`;
}

function kingSquare(board: Chess, color: Color): Square | undefined {
  return board.board().flat().find((piece) => piece?.type === "k" && piece.color === color)?.square;
}

function describeMove(move: Move, learner: Color): { text: string; squares: string[] } {
  const subject = `${owner(move.color, learner, true)} ${PIECE_NAMES[move.piece]}`;
  const opponent: Color = move.color === "w" ? "b" : "w";
  const squares: string[] = [move.from, move.to];
  let text: string;

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    const kingside = move.isKingsideCastle();
    const rank = move.color === "w" ? "1" : "8";
    const rookFrom = `${kingside ? "h" : "a"}${rank}`;
    const rookTo = `${kingside ? "f" : "d"}${rank}`;
    squares.push(rookFrom, rookTo);
    text = `${move.color === learner ? "You castle" : `${colorName(move.color)} castles`} ${kingside ? "kingside" : "queenside"}: the king moves from ${move.from} to ${move.to} and the rook from ${rookFrom} to ${rookTo}.`;
  } else if (move.isEnPassant()) {
    const captureSquare = `${move.to[0]}${move.from[1]}`;
    squares.push(captureSquare);
    text = `${subject} captures ${owner(opponent, learner)} pawn on ${captureSquare} en passant and lands on ${move.to}.`;
  } else if (move.captured) {
    text = `${subject} captures ${owner(opponent, learner)} ${PIECE_NAMES[move.captured]} on ${move.to}${move.promotion ? ` and promotes to a ${PIECE_NAMES[move.promotion]}` : ""}.`;
  } else if (move.promotion) {
    text = `${subject} reaches ${move.to} and promotes to a ${PIECE_NAMES[move.promotion]}.`;
  } else {
    text = `${subject} moves from ${move.from} to ${move.to}.`;
  }

  return { text, squares };
}

// Untimed evidence in old saved assessments describes a whole continuation;
// it must not be pasted onto an arbitrary frame.
function evidenceAt(evidence: readonly CoachingEvidence[], line: CoachingLine, ply: number) {
  for (const item of evidence) {
    if (item.line !== line) continue;
    // A staged explanation takes precedence over its whole-line summary.
    if (item.steps?.length) {
      const step = item.steps.find((candidate) => candidate.ply === ply && candidate.text.trim());
      if (step) return step;
    } else if (item.ply === ply && item.text.trim()) {
      return item;
    }
  }
  return undefined;
}

function positionFact(board: Chess, existingText: string): { text: string; squares: string[] } {
  const king = kingSquare(board, board.turn());
  const squares = board.isCheck() && king ? [king] : [];
  if (board.isCheckmate()) {
    return {
      text: /checkmat|\bmate\b/i.test(existingText) ? "" : `${colorName(board.turn())}'s king is checkmated: it is in check and there is no legal reply.`,
      squares,
    };
  }
  if (board.isStalemate()) {
    return {
      text: /stalemate/i.test(existingText) ? "" : `${colorName(board.turn())} has no legal move and is not in check: this is stalemate.`,
      squares,
    };
  }
  if (board.isCheck()) {
    return {
      text: /\bcheck\b/i.test(existingText) ? "" : `${colorName(board.turn())}'s king on ${king} is in check; the next move must answer it.`,
      squares,
    };
  }
  return { text: "", squares };
}

/**
 * Narrate only facts visible at this position. A legal engine continuation is
 * an illustration, not proof that every move in it is forced. Invalid lines
 * stay at their starting position; malformed starting positions yield no steps.
 */
export function buildCoachingWalkthrough(assessment: MoveAssessment, line: CoachingLine): CoachingWalkthroughStep[] {
  let beforeFen: string;
  try {
    beforeFen = canonicalFen(assessment.beforeFen);
  } catch {
    return [];
  }
  const initialEvidence = evidenceAt(assessment.evidence, line, 0);
  const initial: CoachingWalkthroughStep = {
    ply: 0,
    fen: beforeFen,
    title: "Before your move",
    text: initialEvidence?.text ?? (line === "played"
      ? "Follow the continuation after your move, one move at a time."
      : "Compare the continuation after the suggested alternative, one move at a time."),
    squares: squareList(initialEvidence?.squares ?? []),
  };
  const moves = line === "played" ? assessment.playedLine : assessment.bestLine;
  const expectedMove = line === "played" ? assessment.playedMove : assessment.bestMove;
  const replay = replayCoachingLine(beforeFen, moves);
  if (!replay.legal || (moves.length > 0 && moves[0] !== expectedMove)) {
    return [{ ...initial, text: "This continuation is unavailable. Analyze the move again to try a new continuation.", squares: [] }];
  }
  const learner = new Chess(beforeFen).turn();
  return [initial, ...replay.moves.map((move, index): CoachingWalkthroughStep => {
    const ply = index + 1;
    const board = new Chess(replay.fens[ply]);
    const basic = describeMove(move, learner);
    const evidence = evidenceAt(assessment.evidence, line, ply);
    const text = evidence?.text ?? basic.text;
    const fact = positionFact(board, text);
    return {
      ply,
      fen: board.fen(),
      title: `${ply === 1 ? (line === "played" ? "Your move" : "Alternative") : colorName(move.color)}: ${move.san}`,
      text: [text, fact.text].filter(Boolean).join(" "),
      squares: squareList([...basic.squares, ...(evidence?.squares ?? []), ...fact.squares]),
      move: moveToUci(move),
    };
  })];
}
