import { parseGames, split, type ParseTree } from "@mliebelt/pgn-parser";
import { Chess, DEFAULT_POSITION, type PieceSymbol } from "chess.js";

import { canonicalEpd, canonicalFen, moveToUci } from "./chess";
import {
  openingRecallPrompts,
  type OpeningRecallPrompt,
} from "./curriculum";
import type {
  CanonicalEpd,
  ChessColor,
  GameReviewResult,
  ImportedGame,
  UciMove,
} from "./types";

type ReviewClassification =
  GameReviewResult["criticalMoments"][number]["classification"];

interface PgnMoveLike {
  notation?: { notation?: string | null } | null;
  variations?: PgnMoveLike[][] | null;
  nag?: string[] | null;
  commentMove?: string | null;
  commentAfter?: string | null;
  commentDiag?: { comment?: string | null } | null;
}

export class GameReviewError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GameReviewError";
  }
}

export interface ParseImportedGamesOptions {
  /** Injecting this value makes imports exactly reproducible in tests/migrations. */
  importedAt?: string;
  /** Used for every game unless learnerName identifies a side per game. */
  learnerColor?: ChessColor;
  /** Case-insensitive exact match against the White and Black PGN tags. */
  learnerName?: string;
}

export interface ImportedGameMove {
  schemaVersion: 1;
  id: string;
  ply: number;
  moveNumber: number;
  color: ChessColor;
  san: string;
  uci: UciMove;
  beforeFen: string;
  afterFen: string;
  beforeKey: CanonicalEpd;
  afterKey: CanonicalEpd;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isCapture: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  comments: string[];
  nags: string[];
  /** Number of RAV branches attached directly to this main-line move. */
  variationCount: number;
  /** Total annotated plies below all RAV branches attached to this move. */
  variationPlyCount: number;
  /** Deepest RAV nesting below this move; zero means no variation. */
  variationDepth: number;
}

export interface ImportedGameSummary {
  schemaVersion: 1;
  id: string;
  gameIndex: number;
  title: string;
  white: string;
  black: string;
  result: string;
  tags: Record<string, string>;
  rootFen: string;
  rootKey: CanonicalEpd;
  finalFen: string;
  totalPlies: number;
}

export interface ParsedImportedGame {
  schemaVersion: 1;
  importedGame: ImportedGame;
  summary: ImportedGameSummary;
  moves: ImportedGameMove[];
}

export interface RepertoirePositionMatch {
  schemaVersion: 1;
  ply: number;
  fen: string;
  epd: CanonicalEpd;
  playedMove: UciMove;
  promptIds: string[];
  acceptedMoves: UciMove[];
  learnerDecision: boolean;
  /** Undefined means that this prompt is instructional but not move-graded. */
  accepted: boolean | undefined;
}

export interface RepertoireDeparture {
  schemaVersion: 1;
  ply: number;
  fen: string;
  epd: CanonicalEpd;
  playedMove: UciMove;
  playedSan: string;
  promptIds: string[];
  acceptedMoves: UciMove[];
}

export interface RepertoireCoverage {
  schemaVersion: 1;
  matchedPromptIds: string[];
  matchedPositionKeys: CanonicalEpd[];
  /** Percentage of supplied recall prompts encountered at least once. */
  promptCoveragePercent: number;
  /** Known, move-graded positions where it was the learner's turn. */
  learnerDecisionCount: number;
  acceptedDecisionCount: number;
  /** Accepted known decisions / all known learner decisions. */
  decisionAccuracyPercent: number;
  matches: RepertoirePositionMatch[];
  firstDeparture?: RepertoireDeparture;
}

export interface ReviewCandidate {
  schemaVersion: 1;
  id: string;
  ply: number;
  fen: string;
  epd: CanonicalEpd;
  playedMove: UciMove;
  playedSan: string;
  classification: ReviewClassification;
  rationale: string;
}

export interface LocalGameReview {
  schemaVersion: 1;
  game: ParsedImportedGame;
  coverage: RepertoireCoverage;
  candidates: ReviewCandidate[];
  result: GameReviewResult;
}

export interface ReviewImportedGameOptions {
  learnerColor?: ChessColor;
  prompts?: readonly OpeningRecallPrompt[];
  generatedAt?: string;
}

export interface ParseAndReviewOptions
  extends ParseImportedGamesOptions,
    Omit<ReviewImportedGameOptions, "learnerColor"> {
  /** Required when neither the PGN tags nor learnerName identify a side. */
  learnerColor: ChessColor;
}

function shortHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function asIsoTimestamp(value: string | undefined, label: string): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new GameReviewError(`${label} must be a valid ISO-compatible timestamp.`);
  }
  return timestamp;
}

function stringTags(tags: ParseTree["tags"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tags) return result;
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === "string") result[key] = value;
    else if (
      typeof value === "object"
      && value !== null
      && "value" in value
      && typeof value.value === "string"
    ) {
      // The parser expands Date/Time/TimeControl tags into structured values.
      // Keep their lossless PGN spelling in the stable browser-facing summary.
      result[key] = value.value;
    }
  }
  return result;
}

function commentsForMove(move: PgnMoveLike): string[] {
  return [...new Set([
    move.commentMove,
    move.commentAfter,
    move.commentDiag?.comment,
  ]
    .filter((comment): comment is string => typeof comment === "string")
    .map((comment) => comment.trim())
    .filter(Boolean))];
}

function variationMetrics(variations: readonly PgnMoveLike[][]): {
  plies: number;
  depth: number;
} {
  let plies = 0;
  let depth = 0;
  const stack = variations.map((line) => ({ line, level: 1 }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    depth = Math.max(depth, current.level);
    for (const move of current.line) {
      plies += 1;
      for (const nested of move.variations ?? []) {
        stack.push({ line: nested, level: current.level + 1 });
      }
    }
  }

  return { plies, depth };
}

function parserLocation(error: unknown): string {
  if (typeof error !== "object" || error === null || !("location" in error)) return "";
  const location = (error as {
    location?: { start?: { line?: unknown; column?: unknown } };
  }).location;
  const line = location?.start?.line;
  const column = location?.start?.column;
  return typeof line === "number" && typeof column === "number"
    ? ` at line ${line}, column ${column}`
    : "";
}

function individualSources(source: string, gameCount: number): string[] {
  try {
    const games = split(source);
    if (games.length === gameCount) return games.map(({ all }) => all.trim());
  } catch {
    // parseGames already validated the source. Falling back preserves data even
    // when a non-export-format PGN cannot be losslessly split.
  }
  return Array.from({ length: gameCount }, () => source.trim());
}

function inferredLearnerColor(
  tags: Readonly<Record<string, string>>,
  options: ParseImportedGamesOptions,
): ChessColor | undefined {
  if (options.learnerName?.trim()) {
    const learner = options.learnerName.trim().toLowerCase();
    const whiteMatches = tags.White?.trim().toLowerCase() === learner;
    const blackMatches = tags.Black?.trim().toLowerCase() === learner;
    if (whiteMatches !== blackMatches) return whiteMatches ? "w" : "b";
  }

  if (options.learnerColor) return options.learnerColor;
  const orientation = tags.Orientation?.trim().toLowerCase();
  if (orientation === "white") return "w";
  if (orientation === "black") return "b";
  return undefined;
}

function rootFenForGame(game: ParseTree, gameNumber: number): string {
  const rawFen = game.tags?.FEN;
  try {
    return canonicalFen(typeof rawFen === "string" ? rawFen : DEFAULT_POSITION);
  } catch (error) {
    throw new GameReviewError(
      `Game ${gameNumber} has an invalid FEN header${
        typeof rawFen === "string" ? `: ${rawFen}` : "."
      }`,
      { cause: error },
    );
  }
}

function replayMainLine(
  game: ParseTree,
  gameNumber: number,
  gameId: string,
  rootFen: string,
): ImportedGameMove[] {
  if (!Array.isArray(game.moves) || game.moves.length === 0) {
    throw new GameReviewError(`Game ${gameNumber} contains no main-line moves.`);
  }

  const board = new Chess(rootFen);
  const moves: ImportedGameMove[] = [];
  for (let index = 0; index < game.moves.length; index += 1) {
    const sourceMove = game.moves[index] as PgnMoveLike;
    const san = sourceMove.notation?.notation?.trim();
    if (!san) {
      throw new GameReviewError(
        `Game ${gameNumber} has a main-line move without SAN at ply ${index + 1}.`,
      );
    }

    const beforeFen = board.fen();
    let played;
    try {
      played = board.move(san);
    } catch (error) {
      throw new GameReviewError(
        `Game ${gameNumber} contains illegal main-line move "${san}" at ply ${
          index + 1
        } (move ${Math.floor(index / 2) + 1}${index % 2 === 0 ? "." : "..."}).`,
        { cause: error },
      );
    }

    const afterFen = board.fen();
    const variations = sourceMove.variations ?? [];
    const metrics = variationMetrics(variations);
    const moveNumber = Number(beforeFen.split(" ")[5]);
    moves.push({
      schemaVersion: 1,
      id: `${gameId}:move:${String(index + 1).padStart(4, "0")}`,
      ply: index + 1,
      moveNumber,
      color: played.color,
      san: played.san,
      uci: moveToUci(played),
      beforeFen,
      afterFen,
      beforeKey: canonicalEpd(beforeFen),
      afterKey: canonicalEpd(afterFen),
      ...(played.captured ? { captured: played.captured } : {}),
      ...(played.promotion ? { promotion: played.promotion } : {}),
      isCapture: Boolean(played.captured),
      isCheck: board.isCheck(),
      isCheckmate: board.isCheckmate(),
      comments: commentsForMove(sourceMove),
      nags: Array.isArray(sourceMove.nag) ? sourceMove.nag.filter(Boolean) : [],
      variationCount: variations.length,
      variationPlyCount: metrics.plies,
      variationDepth: metrics.depth,
    });
  }
  return moves;
}

function gameSignature(
  tags: Readonly<Record<string, string>>,
  rootFen: string,
  sans: readonly string[],
): string {
  const identityTags = ["Event", "Site", "Date", "Round", "White", "Black", "Result"]
    .map((key) => `${key}=${tags[key] ?? ""}`)
    .join("|");
  return `${canonicalEpd(rootFen)}|${identityTags}|${sans.join(" ")}`;
}

/**
 * Parses every game in an import with @mliebelt/pgn-parser, then independently
 * replays each main line with chess.js. RAVs are retained as metadata but never
 * contaminate the game line presented for review.
 */
export function parseImportedGames(
  pgn: string,
  options: ParseImportedGamesOptions = {},
): ParsedImportedGame[] {
  if (!pgn.trim()) throw new GameReviewError("The PGN import is empty.");
  const importedAt = asIsoTimestamp(options.importedAt, "importedAt");

  let games: ParseTree[];
  try {
    games = parseGames(pgn);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown parser error.";
    throw new GameReviewError(
      `Could not parse PGN${parserLocation(error)}: ${detail}`,
      { cause: error },
    );
  }
  if (games.length === 0) throw new GameReviewError("The PGN did not contain a game.");

  const sources = individualSources(pgn, games.length);
  const duplicateCounts = new Map<string, number>();

  return games.map((game, index) => {
    const gameNumber = index + 1;
    const tags = stringTags(game.tags);
    const rootFen = rootFenForGame(game, gameNumber);
    const sans = (game.moves as PgnMoveLike[]).map(
      (move) => move.notation?.notation?.trim() ?? "?",
    );
    const signature = gameSignature(tags, rootFen, sans);
    const baseId = `imported-${shortHash(signature)}`;
    const duplicateNumber = (duplicateCounts.get(baseId) ?? 0) + 1;
    duplicateCounts.set(baseId, duplicateNumber);
    const id = duplicateNumber === 1 ? baseId : `${baseId}-${duplicateNumber}`;
    const moves = replayMainLine(game, gameNumber, id, rootFen);
    const learnerColor = inferredLearnerColor(tags, options);
    const white = tags.White?.trim() || "White";
    const black = tags.Black?.trim() || "Black";
    const result = tags.Result?.trim() || "*";

    const importedGame: ImportedGame = {
      schemaVersion: 1,
      id,
      importedAt,
      pgn: sources[index] ?? pgn.trim(),
      ...(tags.White ? { white: tags.White } : {}),
      ...(tags.Black ? { black: tags.Black } : {}),
      ...(tags.Result ? { result: tags.Result } : {}),
      ...(learnerColor ? { learnerColor } : {}),
    };
    const finalFen = moves.at(-1)?.afterFen ?? rootFen;

    return {
      schemaVersion: 1,
      importedGame,
      summary: {
        schemaVersion: 1,
        id,
        gameIndex: index,
        title: `${white} – ${black}`,
        white,
        black,
        result,
        tags,
        rootFen,
        rootKey: canonicalEpd(rootFen),
        finalFen,
        totalPlies: moves.length,
      },
      moves,
    };
  });
}

function buildPromptIndex(
  prompts: readonly OpeningRecallPrompt[],
): Map<CanonicalEpd, OpeningRecallPrompt[]> {
  const index = new Map<CanonicalEpd, OpeningRecallPrompt[]>();
  for (const prompt of prompts) {
    let key: CanonicalEpd;
    try {
      key = canonicalEpd(prompt.fen);
    } catch (error) {
      throw new GameReviewError(`Recall prompt ${prompt.id} has an invalid FEN.`, {
        cause: error,
      });
    }
    const existing = index.get(key) ?? [];
    existing.push(prompt);
    index.set(key, existing);
  }
  return index;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function repertoireCoverage(
  game: ParsedImportedGame,
  learnerColor: ChessColor,
  prompts: readonly OpeningRecallPrompt[],
): RepertoireCoverage {
  const promptIndex = buildPromptIndex(prompts);
  const matches: RepertoirePositionMatch[] = [];
  let firstDeparture: RepertoireDeparture | undefined;

  for (const move of game.moves) {
    const matchingPrompts = promptIndex.get(move.beforeKey);
    if (!matchingPrompts?.length) continue;
    const promptIds = uniqueSorted(matchingPrompts.map(({ id }) => id));
    // A transposed position may intentionally have multiple authored plans.
    // Accept the union so one sound repertoire branch never invalidates another.
    const acceptedMoves = uniqueSorted(
      matchingPrompts.flatMap(({ acceptedMoves: accepted }) => accepted ?? []),
    );
    const learnerDecision = move.color === learnerColor;
    const accepted = learnerDecision && acceptedMoves.length > 0
      ? acceptedMoves.includes(move.uci)
      : undefined;

    matches.push({
      schemaVersion: 1,
      ply: move.ply,
      fen: move.beforeFen,
      epd: move.beforeKey,
      playedMove: move.uci,
      promptIds,
      acceptedMoves,
      learnerDecision,
      accepted,
    });

    if (accepted === false && !firstDeparture) {
      firstDeparture = {
        schemaVersion: 1,
        ply: move.ply,
        fen: move.beforeFen,
        epd: move.beforeKey,
        playedMove: move.uci,
        playedSan: move.san,
        promptIds,
        acceptedMoves,
      };
    }
  }

  const matchedPromptIds = uniqueSorted(matches.flatMap(({ promptIds }) => promptIds));
  const matchedPositionKeys = uniqueSorted(matches.map(({ epd }) => epd));
  const gradedLearnerDecisions = matches.filter(
    ({ learnerDecision, acceptedMoves }) => learnerDecision && acceptedMoves.length > 0,
  );
  const acceptedDecisionCount = gradedLearnerDecisions.filter(
    ({ accepted }) => accepted,
  ).length;

  return {
    schemaVersion: 1,
    matchedPromptIds,
    matchedPositionKeys,
    promptCoveragePercent: prompts.length === 0
      ? 0
      : Math.round((matchedPromptIds.length / prompts.length) * 100),
    learnerDecisionCount: gradedLearnerDecisions.length,
    acceptedDecisionCount,
    decisionAccuracyPercent: gradedLearnerDecisions.length === 0
      ? 0
      : Math.round((acceptedDecisionCount / gradedLearnerDecisions.length) * 100),
    matches,
    ...(firstDeparture ? { firstDeparture } : {}),
  };
}

function isEndgamePosition(fen: string): boolean {
  const board = new Chess(fen);
  const pieces = board.board().flat().filter((piece) => piece !== null);
  const queens = pieces.filter(({ type }) => type === "q").length;
  const nonPawnNonKing = pieces.filter(
    ({ type }) => type !== "p" && type !== "k",
  ).length;
  return pieces.length <= 10 || (queens === 0 && nonPawnNonKing <= 6);
}

function forcingScore(
  move: ImportedGameMove,
  previous: ImportedGameMove | undefined,
): number {
  return (move.isCheckmate ? 10 : 0)
    + (move.isCheck ? 5 : 0)
    + (move.isCapture ? 4 : 0)
    + (move.promotion ? 4 : 0)
    + (previous?.isCheck ? 3 : 0)
    + (previous?.isCapture ? 1 : 0);
}

function candidateFromMove(
  gameId: string,
  move: ImportedGameMove,
  classification: ReviewClassification,
  rationale: string,
): ReviewCandidate {
  return {
    schemaVersion: 1,
    id: `${gameId}:candidate:${classification}:${String(move.ply).padStart(4, "0")}`,
    ply: move.ply,
    fen: move.beforeFen,
    epd: move.beforeKey,
    playedMove: move.uci,
    playedSan: move.san,
    classification,
    rationale,
  };
}

/** Pure heuristic nomination; Stockfish may later rank/evaluate these positions. */
export function nominateReviewCandidates(
  game: ParsedImportedGame,
  learnerColor: ChessColor,
  coverage: RepertoireCoverage,
): ReviewCandidate[] {
  const learnerMoves = game.moves.filter(({ color }) => color === learnerColor);
  if (learnerMoves.length === 0) return [];
  const selected = new Map<number, ReviewCandidate>();

  const departureMove = coverage.firstDeparture
    ? learnerMoves.find(({ ply }) => ply === coverage.firstDeparture?.ply)
    : undefined;
  const knownLearnerMatches = coverage.matches.filter(
    ({ learnerDecision, acceptedMoves }) => learnerDecision && acceptedMoves.length > 0,
  );
  const knownOpeningMove = knownLearnerMatches.length > 0
    ? learnerMoves.find(({ ply }) => ply === knownLearnerMatches.at(-1)?.ply)
    : undefined;
  const beganFromInitialPosition = game.summary.rootKey === canonicalEpd(DEFAULT_POSITION);
  const genericOpeningMove = beganFromInitialPosition
    ? learnerMoves.filter(({ ply }) => ply <= 16).at(-1)
    : undefined;
  const openingMove = departureMove ?? knownOpeningMove ?? genericOpeningMove;
  if (openingMove) {
    selected.set(
      openingMove.ply,
      candidateFromMove(
        game.importedGame.id,
        openingMove,
        "opening",
        departureMove
          ? "This is the first trained position where the game left every accepted repertoire move."
          : knownOpeningMove
            ? "This is the deepest trained opening decision reached in the game."
            : "This late opening decision is a useful baseline when no trained tabiya was reached.",
      ),
    );
  }

  const tacticalMove = learnerMoves
    .filter((move) => !selected.has(move.ply))
    .map((move) => ({
      move,
      score: forcingScore(move, game.moves[move.ply - 2]),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.move.ply - right.move.ply)[0]
    ?.move;
  if (tacticalMove) {
    selected.set(
      tacticalMove.ply,
      candidateFromMove(
        game.importedGame.id,
        tacticalMove,
        "tactic",
        "A check, capture, promotion, or forcing reply makes this suitable for concrete recalculation.",
      ),
    );
  }

  const endgameMove = learnerMoves.find(
    (move) => !selected.has(move.ply) && isEndgamePosition(move.beforeFen),
  );
  if (endgameMove && selected.size < 3) {
    selected.set(
      endgameMove.ply,
      candidateFromMove(
        game.importedGame.id,
        endgameMove,
        "endgame",
        "The material level has crossed into an endgame, where activity and precise technique deserve a fresh decision.",
      ),
    );
  }

  if (selected.size < 3) {
    const targetPly = Math.max(17, Math.round(game.moves.length * 0.55));
    const strategyMove = learnerMoves
      .filter((move) => (
        !selected.has(move.ply)
        && move.ply > 16
        && !isEndgamePosition(move.beforeFen)
        && forcingScore(move, game.moves[move.ply - 2]) === 0
      ))
      .sort((left, right) => (
        Math.abs(left.ply - targetPly) - Math.abs(right.ply - targetPly)
        || left.ply - right.ply
      ))[0];
    if (strategyMove) {
      selected.set(
        strategyMove.ply,
        candidateFromMove(
          game.importedGame.id,
          strategyMove,
          "strategy",
          "This quiet middlegame turn is near the game's centre and tests plan choice without a forcing shortcut.",
        ),
      );
    }
  }

  // A very short or quiet game can yield fewer than three distinct phases.
  return [...selected.values()]
    .sort((left, right) => left.ply - right.ply)
    .slice(0, 3);
}

export function reviewImportedGame(
  game: ParsedImportedGame,
  options: ReviewImportedGameOptions = {},
): LocalGameReview {
  const learnerColor = options.learnerColor ?? game.importedGame.learnerColor;
  if (!learnerColor) {
    throw new GameReviewError(
      `Learner color is required to review ${game.summary.title}. Pass learnerColor or learnerName when importing.`,
    );
  }
  const generatedAt = asIsoTimestamp(options.generatedAt, "generatedAt");
  const prompts = options.prompts ?? openingRecallPrompts;
  const coverage = repertoireCoverage(game, learnerColor, prompts);
  const candidates = nominateReviewCandidates(game, learnerColor, coverage);
  const resultId = `review-${shortHash(
    `${game.importedGame.id}|${learnerColor}|${prompts.map(({ id }) => id).join("|")}`,
  )}`;
  const result: GameReviewResult = {
    schemaVersion: 1,
    id: resultId,
    importedGameId: game.importedGame.id,
    repertoirePositionIds: coverage.matchedPromptIds,
    ...(coverage.firstDeparture
      ? {
          firstDeparture: {
            ply: coverage.firstDeparture.ply,
            fen: coverage.firstDeparture.fen,
            playedMove: coverage.firstDeparture.playedMove,
          },
        }
      : {}),
    criticalMoments: candidates.map((candidate) => ({
      id: candidate.id,
      ply: candidate.ply,
      fen: candidate.fen,
      classification: candidate.classification,
    })),
    generatedAt,
  };

  return {
    schemaVersion: 1,
    game,
    coverage,
    candidates,
    result,
  };
}

export function parseAndReviewPgn(
  pgn: string,
  options: ParseAndReviewOptions,
): LocalGameReview[] {
  const games = parseImportedGames(pgn, options);
  return games.map((game) => reviewImportedGame(game, {
    learnerColor: game.importedGame.learnerColor ?? options.learnerColor,
    prompts: options.prompts,
    generatedAt: options.generatedAt,
  }));
}
