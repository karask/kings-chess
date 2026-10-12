import { parseGames, type ParseTree } from "@mliebelt/pgn-parser";
import { Chess, DEFAULT_POSITION } from "chess.js";

import { canonicalEpd, canonicalFen, moveToUci, parseUciMove } from "./chess";
import type {
  CanonicalEpd,
  ParseRepertoireOptions,
  Repertoire,
  RepertoireMove,
  RepertoireMoveMatch,
  RepertoirePosition,
  RepertoireWalkResult,
  UciMove,
} from "./types";

interface PgnMoveLike {
  notation: { notation: string };
  variations?: PgnMoveLike[][] | null;
  nag?: string[] | null;
  commentMove?: string | null;
  commentAfter?: string | null;
  commentDiag?: { comment?: string | null } | null;
}

export class RepertoirePgnError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepertoirePgnError";
  }
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stringTags(tags: ParseTree["tags"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tags) return result;
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function moveComments(move: PgnMoveLike): string[] {
  return [...new Set([move.commentMove, move.commentAfter, move.commentDiag?.comment]
    .filter((comment): comment is string => typeof comment === "string")
    .map((comment) => comment.trim())
    .filter(Boolean))];
}

function mergeUnique(target: string[], additions: readonly string[]): void {
  for (const value of additions) {
    if (!target.includes(value)) target.push(value);
  }
}

function rootFenForGame(game: ParseTree): string {
  const tagFen = game.tags?.FEN;
  return canonicalFen(typeof tagFen === "string" ? tagFen : DEFAULT_POSITION);
}

/**
 * Parses one or more PGN games into a JSON-friendly position graph. Positions
 * are keyed by canonical EPD, so different move orders converge on one node.
 */
export function parseRepertoirePgn(
  pgn: string,
  options: ParseRepertoireOptions = {},
): Repertoire {
  if (!pgn.trim()) {
    throw new RepertoirePgnError("Repertoire PGN is empty.");
  }

  let parsedGames: ParseTree[];
  try {
    parsedGames = parseGames(pgn);
  } catch (error) {
    throw new RepertoirePgnError("Could not parse repertoire PGN.", { cause: error });
  }
  if (parsedGames.length === 0) {
    throw new RepertoirePgnError("The PGN did not contain a game.");
  }

  const positions: Record<CanonicalEpd, RepertoirePosition> = {};
  const games: Repertoire["games"] = [];
  const rootKeys: CanonicalEpd[] = [];

  function ensurePosition(fen: string, ply: number): RepertoirePosition {
    const normalizedFen = canonicalFen(fen);
    const key = canonicalEpd(normalizedFen);
    const existing = positions[key];
    if (existing) {
      existing.minPly = Math.min(existing.minPly, ply);
      return existing;
    }
    const position: RepertoirePosition = {
      key,
      fen: normalizedFen,
      turn: normalizedFen.split(" ")[1] as "w" | "b",
      minPly: ply,
      moves: [],
    };
    positions[key] = position;
    return position;
  }

  function addMove(
    from: RepertoirePosition,
    edge: RepertoireMove,
  ): void {
    const existing = from.moves.find((candidate) => candidate.uci === edge.uci);
    if (!existing) {
      from.moves.push(edge);
      return;
    }
    if (existing.toKey !== edge.toKey) {
      throw new RepertoirePgnError(
        `Move ${edge.uci} from ${from.key} produced conflicting destination positions.`,
      );
    }
    existing.mainline ||= edge.mainline;
    mergeUnique(existing.comments, edge.comments);
    mergeUnique(existing.nags, edge.nags);
    for (const gameIndex of edge.gameIndexes) {
      if (!existing.gameIndexes.includes(gameIndex)) existing.gameIndexes.push(gameIndex);
    }
  }

  function walkLine(
    moves: readonly PgnMoveLike[],
    lineStartFen: string,
    startPly: number,
    mainline: boolean,
    gameIndex: number,
  ): number {
    const board = new Chess(lineStartFen);
    let ply = startPly;

    for (const parsedMove of moves) {
      const san = parsedMove.notation?.notation;
      if (!san) {
        throw new RepertoirePgnError(`Game ${gameIndex + 1} contains a move without SAN.`);
      }

      const beforeFen = board.fen();
      const from = ensurePosition(beforeFen, ply);
      let played;
      try {
        played = board.move(san);
      } catch (error) {
        throw new RepertoirePgnError(
          `Illegal PGN move ${san} in game ${gameIndex + 1}, ply ${ply + 1}.`,
          { cause: error },
        );
      }
      const afterFen = board.fen();
      const to = ensurePosition(afterFen, ply + 1);
      addMove(from, {
        uci: moveToUci(played),
        san: played.san,
        turn: played.color,
        fromKey: from.key,
        toKey: to.key,
        toFen: afterFen,
        mainline,
        comments: moveComments(parsedMove),
        nags: Array.isArray(parsedMove.nag) ? parsedMove.nag.filter(Boolean) : [],
        gameIndexes: [gameIndex],
      });

      // A recursive annotation variation replaces the move it follows, so it
      // starts from beforeFen rather than the position after that move.
      for (const variation of parsedMove.variations ?? []) {
        walkLine(variation, beforeFen, ply, false, gameIndex);
      }
      ply += 1;
    }
    return ply - startPly;
  }

  parsedGames.forEach((game, index) => {
    const rootFen = rootFenForGame(game);
    const rootKey = canonicalEpd(rootFen);
    ensurePosition(rootFen, 0);
    if (!rootKeys.includes(rootKey)) rootKeys.push(rootKey);
    const mainlinePlies = walkLine(game.moves as PgnMoveLike[], rootFen, 0, true, index);
    games.push({
      index,
      rootKey,
      rootFen,
      tags: stringTags(game.tags),
      mainlinePlies,
    });
  });

  for (const position of Object.values(positions)) {
    position.moves.sort((left, right) => {
      if (left.mainline !== right.mainline) return left.mainline ? -1 : 1;
      return left.san.localeCompare(right.san);
    });
  }

  return {
    id: options.id ?? `repertoire-${shortHash(pgn)}`,
    name: options.name ?? "Imported repertoire",
    playerColor: options.playerColor ?? "both",
    rootKeys,
    positions,
    games,
  };
}

export function getRepertoirePosition(
  repertoire: Repertoire,
  fen: string,
): RepertoirePosition | undefined {
  return repertoire.positions[canonicalEpd(fen)];
}

export function getRepertoireMoves(repertoire: Repertoire, fen: string): RepertoireMove[] {
  return getRepertoirePosition(repertoire, fen)?.moves ?? [];
}

function normalizeMoveAtFen(fen: string, move: string): UciMove | null {
  try {
    const parsed = parseUciMove(move);
    const board = new Chess(canonicalFen(fen));
    const played = board.move(parsed);
    return moveToUci(played);
  } catch {
    try {
      const board = new Chess(canonicalFen(fen));
      return moveToUci(board.move(move));
    } catch {
      return null;
    }
  }
}

export function matchRepertoireMove(
  repertoire: Repertoire,
  fen: string,
  uciOrSan: string,
): RepertoireMoveMatch {
  const position = getRepertoirePosition(repertoire, fen);
  if (!position) return { matched: false, reason: "position-not-found" };

  const normalized = normalizeMoveAtFen(fen, uciOrSan);
  if (!normalized) return { matched: false, position, reason: "illegal-move" };
  const move = position.moves.find((candidate) => candidate.uci === normalized);
  return move
    ? { matched: true, position, move }
    : { matched: false, position, reason: "move-not-found" };
}

export function walkRepertoireLine(
  repertoire: Repertoire,
  startingFen: string,
  moves: readonly string[],
): RepertoireWalkResult {
  let fen = canonicalFen(startingFen);
  const matchedMoves: RepertoireMove[] = [];

  for (let index = 0; index < moves.length; index += 1) {
    const match = matchRepertoireMove(repertoire, fen, moves[index]);
    if (!match.matched || !match.move) {
      return {
        matched: false,
        finalFen: fen,
        finalKey: canonicalEpd(fen),
        matchedMoves,
        failedAt: index,
        reason: match.reason,
      };
    }
    matchedMoves.push(match.move);
    fen = match.move.toFen;
  }

  return {
    matched: true,
    finalFen: fen,
    finalKey: canonicalEpd(fen),
    matchedMoves,
  };
}
