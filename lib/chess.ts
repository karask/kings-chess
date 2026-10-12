import { Chess, type Move } from "chess.js";

import type {
  AppliedChessMove,
  CanonicalEpd,
  ChessSquare,
  LichessPuzzle,
  ParsedUciMove,
  PreparedPuzzle,
  PuzzleMoveResult,
  PuzzleSession,
  ReviewGrade,
  UciMove,
} from "./types";

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i;

export class ChessDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChessDataError";
  }
}

function fenForChessJs(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) {
    return `${fields.join(" ")} 0 1`;
  }
  if (fields.length !== 6) {
    throw new ChessDataError(`Expected a four- or six-field FEN, received ${fields.length} fields.`);
  }
  return fields.join(" ");
}

function chessFromFen(fen: string): Chess {
  try {
    return new Chess(fenForChessJs(fen));
  } catch (error) {
    throw new ChessDataError(`Invalid FEN: ${fen}`, { cause: error });
  }
}

/** Returns a normalized six-field FEN, including a legally relevant en-passant square only. */
export function canonicalFen(fen: string): string {
  return chessFromFen(fen).fen();
}

/**
 * Produces a stable transposition key. The clocks are excluded; board, side to
 * move, castling rights, and a legally usable en-passant square are retained.
 */
export function canonicalEpd(fen: string): CanonicalEpd {
  return canonicalFen(fen).split(" ").slice(0, 4).join(" ");
}

export function parseUciMove(uci: string): ParsedUciMove {
  const normalized = uci.trim().toLowerCase();
  const match = UCI_PATTERN.exec(normalized);
  if (!match) {
    throw new ChessDataError(`Invalid UCI move: ${uci}`);
  }
  return {
    from: match[1] as ChessSquare,
    to: match[2] as ChessSquare,
    ...(match[3] ? { promotion: match[3] as ParsedUciMove["promotion"] } : {}),
  };
}

export function moveToUci(
  move: Pick<Move, "from" | "to" | "promotion"> | ParsedUciMove,
): UciMove {
  return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
}

function moveUciOnBoard(board: Chess, uci: string): Move {
  const parsed = parseUciMove(uci);
  try {
    return board.move(parsed);
  } catch (error) {
    throw new ChessDataError(`Illegal move ${uci} in ${board.fen()}`, { cause: error });
  }
}

export function applyUciMove(fen: string, uci: string): AppliedChessMove {
  const board = chessFromFen(fen);
  const beforeFen = board.fen();
  const move = moveUciOnBoard(board, uci);
  const afterFen = board.fen();
  return {
    uci: moveToUci(move),
    san: move.san,
    beforeFen,
    afterFen,
    beforeKey: canonicalEpd(beforeFen),
    afterKey: canonicalEpd(afterFen),
    isCheck: board.isCheck(),
    isCheckmate: board.isCheckmate(),
  };
}

export function legalUciMoves(fen: string): UciMove[] {
  return chessFromFen(fen).moves({ verbose: true }).map(moveToUci);
}

export function isLegalUciMove(fen: string, uci: string): boolean {
  try {
    applyUciMove(fen, uci);
    return true;
  } catch {
    return false;
  }
}

export function positionKeyAfterMoves(fen: string, moves: readonly UciMove[]): CanonicalEpd {
  const board = chessFromFen(fen);
  for (const uci of moves) {
    moveUciOnBoard(board, uci);
  }
  return canonicalEpd(board.fen());
}

function parseCsvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ChessDataError("Unterminated quoted field in Lichess puzzle CSV row.");
  }
  fields.push(field);
  return fields;
}

function finiteNumber(value: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ChessDataError(`Invalid ${column} in Lichess puzzle row: ${value}`);
  }
  return parsed;
}

/** Parses one headerless row from database.lichess.org/lichess_db_puzzle.csv.zst. */
export function parseLichessPuzzleCsvLine(line: string): LichessPuzzle {
  const fields = parseCsvFields(line.replace(/\r$/, ""));
  if (fields.length < 9 || fields.length > 11) {
    throw new ChessDataError(`Expected 9 to 11 Lichess puzzle columns, received ${fields.length}.`);
  }

  const [
    id,
    fen,
    moves,
    rating,
    ratingDeviation,
    popularity,
    plays,
    themes,
    gameUrl,
    openingTags = "",
  ] = fields;

  if (!id || !fen || !moves) {
    throw new ChessDataError("Lichess puzzle id, FEN, and moves are required.");
  }

  return {
    id,
    fen,
    moves: moves.trim().split(/\s+/).filter(Boolean).map((move) => move.toLowerCase()),
    rating: finiteNumber(rating, "rating"),
    ratingDeviation: finiteNumber(ratingDeviation, "rating deviation"),
    popularity: finiteNumber(popularity, "popularity"),
    plays: finiteNumber(plays, "play count"),
    themes: themes.trim().split(/\s+/).filter(Boolean),
    gameUrl,
    openingTags: openingTags.trim().split(/\s+/).filter(Boolean),
  };
}

/**
 * Validates a Lichess line and advances its first move. Lichess stores the FEN
 * before the opponent's move, so consumers should render startFen, not fen.
 */
export function prepareLichessPuzzle(puzzle: LichessPuzzle): PreparedPuzzle {
  if (puzzle.moves.length < 2) {
    throw new ChessDataError(`Puzzle ${puzzle.id} has no learner solution.`);
  }

  const sourceFen = canonicalFen(puzzle.fen);
  const board = chessFromFen(sourceFen);
  const normalizedMoves: UciMove[] = [];
  const sans: string[] = [];
  let startFen = "";
  let initialMoveSan = "";

  for (let index = 0; index < puzzle.moves.length; index += 1) {
    const move = moveUciOnBoard(board, puzzle.moves[index]);
    normalizedMoves.push(moveToUci(move));
    sans.push(move.san);
    if (index === 0) {
      initialMoveSan = move.san;
      startFen = board.fen();
    }
  }

  const solution = normalizedMoves.slice(1);
  if (solution.length % 2 === 0) {
    throw new ChessDataError(
      `Puzzle ${puzzle.id} has an even number of post-setup plies and does not end on a learner move.`,
    );
  }

  const startBoard = chessFromFen(startFen);
  return {
    ...puzzle,
    fen: sourceFen,
    moves: normalizedMoves,
    sourceFen,
    sourceKey: canonicalEpd(sourceFen),
    initialMove: normalizedMoves[0],
    initialMoveSan,
    startFen,
    startKey: canonicalEpd(startFen),
    playerColor: startBoard.turn(),
    solution,
    solutionSans: sans.slice(1),
  };
}

export function createPuzzleSession(puzzle: PreparedPuzzle): PuzzleSession {
  return {
    puzzle,
    fen: puzzle.startFen,
    cursor: 0,
    status: "active",
    mistakes: 0,
    hints: 0,
    playedMoves: [],
  };
}

export function recordPuzzleHint(session: PuzzleSession): PuzzleSession {
  if (session.status === "solved") return session;
  return { ...session, hints: session.hints + 1 };
}

/**
 * Grades one learner move and, when correct, automatically applies Lichess's
 * single forced reply. A different final move is accepted only when both the
 * published move and the played move are legal checkmates in one.
 */
export function submitPuzzleMove(session: PuzzleSession, playedUci: string): PuzzleMoveResult {
  if (session.status === "solved") {
    return {
      verdict: "already-solved",
      accepted: false,
      complete: true,
      session,
    };
  }

  const expectedMove = session.puzzle.solution[session.cursor];
  let normalizedPlayed: UciMove;
  let played: AppliedChessMove;
  try {
    const parsed = parseUciMove(playedUci);
    normalizedPlayed = `${parsed.from}${parsed.to}${parsed.promotion ?? ""}`;
    played = applyUciMove(session.fen, normalizedPlayed);
  } catch {
    return {
      verdict: "illegal",
      accepted: false,
      complete: false,
      expectedMove,
      playedMove: playedUci.trim().toLowerCase(),
      session: { ...session, mistakes: session.mistakes + 1 },
    };
  }

  const exact = normalizedPlayed === expectedMove;
  let alternateMate = false;
  if (!exact && session.cursor === session.puzzle.solution.length - 1 && played.isCheckmate) {
    const published = applyUciMove(session.fen, expectedMove);
    alternateMate = published.isCheckmate;
  }

  if (!exact && !alternateMate) {
    return {
      verdict: "incorrect",
      accepted: false,
      complete: false,
      expectedMove,
      playedMove: normalizedPlayed,
      session: { ...session, mistakes: session.mistakes + 1 },
    };
  }

  if (alternateMate) {
    const solvedSession: PuzzleSession = {
      ...session,
      fen: played.afterFen,
      cursor: session.puzzle.solution.length,
      status: "solved",
      playedMoves: [...session.playedMoves, normalizedPlayed],
    };
    return {
      verdict: "alternate-mate",
      accepted: true,
      complete: true,
      expectedMove,
      playedMove: normalizedPlayed,
      session: solvedSession,
    };
  }

  let cursor = session.cursor + 1;
  let fen = played.afterFen;
  const playedMoves = [...session.playedMoves, normalizedPlayed];
  let opponentMove: UciMove | undefined;

  if (cursor < session.puzzle.solution.length) {
    opponentMove = session.puzzle.solution[cursor];
    const reply = applyUciMove(fen, opponentMove);
    fen = reply.afterFen;
    playedMoves.push(opponentMove);
    cursor += 1;
  }

  const complete = cursor >= session.puzzle.solution.length;
  const nextSession: PuzzleSession = {
    ...session,
    fen,
    cursor,
    status: complete ? "solved" : "active",
    playedMoves,
  };

  return {
    verdict: "correct",
    accepted: true,
    complete,
    expectedMove,
    playedMove: normalizedPlayed,
    opponentMove,
    session: nextSession,
  };
}

export function gradePuzzleAttempt(input: {
  solved: boolean;
  mistakes?: number;
  hints?: number;
  elapsedMs?: number;
  easyUnderMs?: number;
}): ReviewGrade {
  if (!input.solved || (input.mistakes ?? 0) > 0) return 1;
  if ((input.hints ?? 0) > 0) return 2;
  if (
    input.elapsedMs !== undefined &&
    input.elapsedMs <= (input.easyUnderMs ?? 8_000)
  ) {
    return 4;
  }
  return 3;
}
