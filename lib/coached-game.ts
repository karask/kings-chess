import { Chess } from "chess.js";

import { canonicalEpd, moveToUci, parseUciMove } from "./chess";
import type { MoveAssessment } from "./coaching";
import type { OpeningFamily } from "./curriculum";
import { getSetting, putSetting } from "./storage";
import type { JsonValue } from "./types";

export interface CoachedGame {
  schemaVersion: 1;
  id: string;
  family: OpeningFamily;
  scenarioId: string;
  startMode: "start" | "tabiya";
  initialFen: string;
  /** Complete UCI history from initialFen, not just the latest position. */
  moves: string[];
  learnerColor: "w" | "b";
  skillLevel: number;
  coaching: "critical" | "every" | "after";
  assessments: Array<{ ply: number; assessment: MoveAssessment }>;
  pausedAtPly?: number;
  reviewSavedPlies?: number[];
  skippedAssessmentPlies?: number[];
  createdAt: string;
  updatedAt: string;
  resigned?: boolean;
}

export interface CoachedScenario {
  id: string;
  family: OpeningFamily;
  label: string;
  description: string;
  tabiyaFen: string;
  /** Authored, legal UCI line from the standard initial position. */
  bookMoves: string[];
}

type ScenarioSource = Omit<CoachedScenario, "tabiyaFen" | "bookMoves"> & {
  tabiyaPly: number;
  san: string;
};

const SCENARIO_SOURCES: ScenarioSource[] = [
  {
    id: "pirc-austrian", family: "pirc", label: "Austrian centre",
    description: "White claims space with f4. Develop, protect your king, and choose when to challenge the centre.",
    tabiyaPly: 7, san: "e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O Bd3 c5",
  },
  {
    id: "pirc-150", family: "pirc", label: "150 Attack",
    description: "White develops Be3 and Qd2 and castles long. Balance central pressure with opposite-wing counterplay.",
    tabiyaPly: 11, san: "e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 O-O O-O-O c6 f3 b5",
  },
  {
    id: "pirc-classical", family: "pirc", label: "Classical development",
    description: "White develops quietly and castles short. Challenge the centre without manufacturing a kingside race.",
    tabiyaPly: 11, san: "e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O Nc6 Be3 e5",
  },
  {
    id: "kid-classical", family: "kid", label: "Closed Classical centre",
    description: "The d5/e5 pawn chain creates space for manoeuvres. Prepare your pawn breaks instead of attacking on autopilot.",
    tabiyaPly: 17, san: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Nd3 f5",
  },
  {
    id: "kid-fianchetto", family: "kid", label: "Fianchetto system",
    description: "White's g2 bishop changes the attacking picture. Look for central and queenside counterplay.",
    tabiyaPly: 11, san: "d4 Nf6 c4 g6 Nf3 Bg7 g3 O-O Bg2 d6 O-O c5 Nc3 Nc6",
  },
  {
    id: "kid-samisch", family: "kid", label: "Sämisch centre",
    description: "White supports e4 with f3. Complete development and challenge the large pawn centre.",
    tabiyaPly: 9, san: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 c5",
  },
  {
    id: "kia-e6", family: "kia", label: "Against …e6",
    description: "A closed centre can justify a kingside plan, but Black has queenside counterplay. Improve your pieces first.",
    tabiyaPly: 18, san: "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b6 e5 Nd7 Nf1 Bb7 h4",
  },
  {
    id: "kia-c5", family: "kia", label: "Against …c5",
    description: "Black controls central dark squares. Compare preparing d4 with a premature kingside attack.",
    tabiyaPly: 14, san: "Nf3 c5 g3 Nc6 Bg2 g6 O-O Bg7 d3 d6 e4 e5 Nbd2 Nge7 c3 O-O Re1",
  },
  {
    id: "kia-dutch", family: "kia", label: "Against a Dutch setup",
    description: "Black has advanced the f-pawn. Challenge the centre and watch the resulting diagonal and square weaknesses.",
    tabiyaPly: 14, san: "Nf3 f5 g3 Nf6 Bg2 g6 O-O Bg7 d3 O-O e4 d6 Nbd2 e5 c3 Nc6 Re1",
  },
];

export const COACHED_SCENARIOS: readonly CoachedScenario[] = SCENARIO_SOURCES.map((source) => {
  const { san, tabiyaPly, ...metadata } = source;
  const board = new Chess();
  const bookMoves: string[] = [];
  let tabiyaFen = "";
  for (const token of san.split(" ")) {
    bookMoves.push(moveToUci(board.move(token)));
    if (bookMoves.length === tabiyaPly) tabiyaFen = board.fen();
  }
  const learnerColor = source.family === "kia" ? "w" : "b";
  if (!tabiyaFen || new Chess(tabiyaFen).turn() !== learnerColor) {
    throw new Error(`Invalid coached-game tabiya: ${source.id}`);
  }
  return { ...metadata, tabiyaFen, bookMoves };
});

export const COACHED_GAME_SETTING = "coached-game:current";
const MAX_PLIES = 1024;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class CoachedGameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoachedGameValidationError";
  }
}

function fail(message: string): never {
  throw new CoachedGameValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function shortString(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || !value.length || value.length > max) fail(`Invalid ${label}.`);
  return value;
}

function uci(value: unknown): string {
  if (typeof value !== "string" || !UCI.test(value)) fail("Invalid saved move.");
  return value;
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

function play(board: Chess, move: string): void {
  try {
    board.move(parseUciMove(uci(move)));
  } catch {
    fail(`Saved game contains an illegal move: ${move}.`);
  }
}

function replay(initialFen: string, moves: readonly string[]): Chess {
  let board: Chess;
  try {
    board = new Chess(initialFen);
  } catch {
    return fail("Saved game contains an invalid position.");
  }
  for (const move of moves) {
    if (board.isGameOver()) fail("Saved game continues after the game has ended.");
    play(board, move);
  }
  return board;
}

function makeGameId(): string {
  return `coached:${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function createCoachedGame(options: {
  family: OpeningFamily;
  scenarioId: string;
  startMode: "start" | "tabiya";
  skillLevel: number;
  coaching: CoachedGame["coaching"];
}): CoachedGame {
  const scenario = COACHED_SCENARIOS.find((item) => item.id === options.scenarioId && item.family === options.family);
  if (!scenario) fail("Choose a scenario from the selected opening family.");
  const now = new Date().toISOString();
  return validateCoachedGame({
    ...options,
    schemaVersion: 1,
    id: makeGameId(),
    initialFen: options.startMode === "tabiya" ? scenario.tabiyaFen : new Chess().fen(),
    learnerColor: options.family === "kia" ? "w" : "b",
    moves: [],
    assessments: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Replay history so repetition, castling and en-passant rights survive reloads. */
export function gameBoard(game: CoachedGame): Chess {
  return replay(game.initialFen, game.moves);
}

export function appendGameMove(game: CoachedGame, move: string): CoachedGame {
  const board = gameBoard(game);
  if (game.resigned || board.isGameOver()) fail("This game has already ended.");
  if (game.moves.length >= MAX_PLIES) fail("This game has reached the saved-move limit.");
  play(board, move);
  const continuing = { ...game };
  delete continuing.pausedAtPly;
  return { ...continuing, moves: [...game.moves, move], updatedAt: new Date().toISOString() };
}

function lastLearnerMoveIndex(game: CoachedGame): number {
  const firstLearnerIndex = new Chess(game.initialFen).turn() === game.learnerColor ? 0 : 1;
  if (game.moves.length <= firstLearnerIndex) return -1;
  return firstLearnerIndex + Math.floor((game.moves.length - firstLearnerIndex - 1) / 2) * 2;
}

/** No replay is needed merely to enable the takeback button on a valid game. */
export function canTakeBack(game: CoachedGame): boolean {
  return lastLearnerMoveIndex(game) >= 0;
}

/**
 * Return to the position before the latest learner decision. If the opponent
 * already replied, that reply is undone too; pending coaching undoes one ply.
 *
 * Taking back creates a new continuation id so later game-id/ply review cards
 * cannot overwrite cards from the discarded line, and old async callbacks can
 * be rejected by identity. Existing spaced-review cards/events are never
 * deleted. Markers for still-retained decisions prevent duplicate saves.
 * Callers must cancel ongoing engine work and disable this while saving a card.
 */
export function takeBackTurn(game: CoachedGame): CoachedGame {
  const index = lastLearnerMoveIndex(game);
  if (index < 0) return game;
  // Check the current legal history before deriving a continuation from it.
  gameBoard(game);
  const next: CoachedGame = {
    ...game,
    id: makeGameId(),
    moves: game.moves.slice(0, index),
    assessments: game.assessments.filter((entry) => entry.ply <= index),
    ...(game.reviewSavedPlies ? { reviewSavedPlies: game.reviewSavedPlies.filter((ply) => ply <= index) } : {}),
    ...(game.skippedAssessmentPlies ? { skippedAssessmentPlies: game.skippedAssessmentPlies.filter((ply) => ply <= index) } : {}),
    updatedAt: new Date().toISOString(),
  };
  delete next.pausedAtPly;
  delete next.resigned;
  return next;
}

/** Book replies are available only in positions actually reached by this line. */
export function opponentBookMove(game: CoachedGame): string | null {
  const board = gameBoard(game);
  if (game.resigned || board.isGameOver() || board.turn() === game.learnerColor) return null;
  const scenario = COACHED_SCENARIOS.find((item) => item.id === game.scenarioId && item.family === game.family);
  if (!scenario) return null;
  const key = canonicalEpd(board.fen());
  const book = new Chess();
  for (const move of scenario.bookMoves) {
    if (canonicalEpd(book.fen()) === key) return move;
    play(book, move);
  }
  return null;
}

export function gameResult(game: CoachedGame): string | null {
  const board = gameBoard(game);
  if (game.resigned) return `${game.learnerColor === "w" ? "Black" : "White"} wins by resignation`;
  if (board.isCheckmate()) return `${board.turn() === "w" ? "Black" : "White"} wins by checkmate`;
  if (board.isStalemate()) return "Draw by stalemate";
  if (board.isThreefoldRepetition()) return "Draw by threefold repetition";
  if (board.isInsufficientMaterial()) return "Draw by insufficient material";
  if (board.isDrawByFiftyMoves()) return "Draw by the fifty-move rule";
  if (board.isDraw()) return "Draw";
  return null;
}

export function gamePgn(game: CoachedGame): string {
  const board = gameBoard(game);
  const result = gameResult(game);
  const score = result?.startsWith("White wins") ? "1-0" : result?.startsWith("Black wins") ? "0-1" : result ? "1/2-1/2" : "*";
  board.header(
    "Event", "King’s Study coached game",
    "Site", "Local",
    "Date", game.createdAt.slice(0, 10).replaceAll("-", "."),
    "White", game.learnerColor === "w" ? "Learner" : "Stockfish",
    "Black", game.learnerColor === "b" ? "Learner" : "Stockfish",
    "Result", score,
    "Opening", COACHED_SCENARIOS.find((item) => item.id === game.scenarioId)?.label ?? game.family.toUpperCase(),
  );
  return board.pgn();
}

function validateScore(value: unknown): void {
  const score = record(value, "engine score");
  if (!oneOf(score.type, ["cp", "mate"]) || typeof score.value !== "number" || !Number.isFinite(score.value) || Math.abs(score.value) > 1_000_000) fail("Invalid engine score.");
  if (score.bound !== undefined && !oneOf(score.bound, ["lower", "upper"])) fail("Invalid engine score bound.");
}

function validateLine(value: unknown, board: Chess, firstMove: string): void {
  if (!Array.isArray(value) || value.length > 64) fail("Invalid saved analysis line.");
  if (value.length && value[0] !== firstMove) fail("Saved analysis line does not match its move.");
  const variation = new Chess(board.fen());
  for (const move of value) play(variation, uci(move));
}

function validateAssessment(value: unknown, board: Chess, playedMove: string): void {
  const assessment = record(value, "move assessment");
  if (assessment.playedMove !== playedMove || assessment.beforeFen !== board.fen()) fail("Move assessment does not match the saved game.");
  const played = new Chess(board.fen()).move(parseUciMove(playedMove));
  const bestMove = uci(assessment.bestMove);
  let bestSan: string;
  try { bestSan = new Chess(board.fen()).move(parseUciMove(bestMove)).san; } catch { return fail("Illegal suggested move in saved assessment."); }
  if (assessment.playedSan !== played.san || assessment.bestSan !== bestSan) fail("Invalid assessment move notation.");
  if (!oneOf(assessment.classification, ["best", "excellent", "good", "inaccuracy", "mistake", "blunder", "unrated"])) fail("Invalid move classification.");
  if (!oneOf(assessment.confidence, ["verified", "limited"])) fail("Invalid assessment confidence.");
  shortString(assessment.title, "assessment title", 256);
  shortString(assessment.explanation, "assessment explanation");
  for (const field of ["authoredContext", "strategicContext"]) {
    if (assessment[field] !== undefined) shortString(assessment[field], field);
  }
  if (assessment.lossCp !== undefined && (typeof assessment.lossCp !== "number" || !Number.isFinite(assessment.lossCp) || assessment.lossCp < 0 || assessment.lossCp > 1_000_000)) fail("Invalid evaluation loss.");
  for (const field of ["bestScore", "playedScore"]) if (assessment[field] !== undefined) validateScore(assessment[field]);
  validateLine(assessment.bestLine, board, bestMove);
  validateLine(assessment.playedLine, board, playedMove);
  if (!Array.isArray(assessment.evidence) || assessment.evidence.length > 8) fail("Invalid coaching evidence.");
  for (const item of assessment.evidence) {
    const evidence = record(item, "coaching evidence");
    if (!oneOf(evidence.kind, ["checkmate", "stalemate", "material", "knight-fork", "authored"])) fail("Invalid evidence kind.");
    shortString(evidence.text, "evidence text");
    if (!Array.isArray(evidence.squares) || evidence.squares.length > 64 || evidence.squares.some((square) => typeof square !== "string" || !/^[a-h][1-8]$/.test(square))) fail("Invalid evidence squares.");
  }
}

/** Reject corrupted backups before rendering or passing moves to the engine. */
export function validateCoachedGame(value: unknown): CoachedGame {
  const game = record(value, "coached game");
  // All saved data must remain finite, bounded JSON, including future optional metadata.
  let nodes = 0;
  function boundJson(item: unknown, depth: number): void {
    nodes += 1;
    if (nodes > 120_000 || depth > 12) fail("Saved game is too large.");
    if (typeof item === "number" && !Number.isFinite(item)) fail("Saved game contains a non-finite number.");
    if (typeof item === "string" && item.length > 4096) fail("Saved game contains oversized text.");
    if (item === undefined) return;
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) return;
    if (typeof item !== "object") fail("Saved game must contain JSON data.");
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail("Saved game must contain plain JSON records.");
    if (Array.isArray(item) && item.length > MAX_PLIES) fail("Saved game contains an oversized list.");
    for (const child of Object.values(item)) boundJson(child, depth + 1);
  }
  boundJson(game, 0);
  if (game.schemaVersion !== 1) fail("Unsupported coached-game version.");
  if (!/^[a-zA-Z0-9:._-]{1,160}$/.test(shortString(game.id, "game identifier", 160))) fail("Invalid game identifier.");
  if (!oneOf(game.family, ["pirc", "kid", "kia"])) fail("Invalid opening family.");
  const scenario = COACHED_SCENARIOS.find((item) => item.id === game.scenarioId && item.family === game.family);
  if (!scenario) fail("Unknown coached-game scenario.");
  if (game.startMode !== "start" && game.startMode !== "tabiya") fail("Invalid game starting mode.");
  if (game.initialFen !== (game.startMode === "start" ? new Chess().fen() : scenario.tabiyaFen)) fail("Game starting position does not match its scenario.");
  if (game.learnerColor !== (game.family === "kia" ? "w" : "b")) fail("Invalid learner colour.");
  if (typeof game.skillLevel !== "number" || !Number.isInteger(game.skillLevel) || game.skillLevel < 0 || game.skillLevel > 20) fail("Invalid opponent difficulty.");
  if (!oneOf(game.coaching, ["critical", "every", "after"])) fail("Invalid coaching preference.");
  for (const field of ["createdAt", "updatedAt"]) {
    const text = shortString(game[field], field, 32);
    const date = new Date(text);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) fail(`Invalid ${field}.`);
  }
  if (!Array.isArray(game.moves) || game.moves.length > MAX_PLIES) fail("Invalid game history.");
  if (!Array.isArray(game.assessments) || game.assessments.length > MAX_PLIES / 2) fail("Invalid assessment history.");
  const assessments = new Map<number, unknown>();
  for (const item of game.assessments) {
    const entry = record(item, "assessment entry");
    if (typeof entry.ply !== "number" || !Number.isInteger(entry.ply) || entry.ply < 1 || entry.ply > game.moves.length || assessments.has(entry.ply)) fail("Invalid assessment move number.");
    assessments.set(entry.ply, entry.assessment);
  }
  const learnerPlies = new Set<number>();
  const board = new Chess(game.initialFen as string);
  for (let index = 0; index < game.moves.length; index += 1) {
    if (board.isGameOver()) fail("Saved game continues after the game has ended.");
    const move = uci(game.moves[index]);
    const isLearner = board.turn() === game.learnerColor;
    if (isLearner) learnerPlies.add(index + 1);
    play(new Chess(board.fen()), move);
    if (assessments.has(index + 1)) {
      if (!isLearner) fail("An assessment must belong to a learner move.");
      validateAssessment(assessments.get(index + 1), board, move);
    }
    play(board, move);
  }
  if (game.pausedAtPly !== undefined && (game.pausedAtPly !== game.moves.length || !learnerPlies.has(game.pausedAtPly as number))) fail("Invalid coaching pause.");
  for (const [field, max] of [["reviewSavedPlies", 3], ["skippedAssessmentPlies", MAX_PLIES / 2]] as const) {
    const list = game[field];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > max || new Set(list).size !== list.length || list.some((ply) => !learnerPlies.has(ply))) fail(`Invalid ${field}.`);
    if (field === "reviewSavedPlies" && list.some((ply) => !assessments.has(ply))) fail("Saved reviews must refer to assessed moves.");
  }
  if (game.resigned !== undefined && typeof game.resigned !== "boolean") fail("Invalid resignation status.");
  return game as unknown as CoachedGame;
}

export async function saveCoachedGame(game: CoachedGame): Promise<void> {
  const valid = validateCoachedGame(game);
  // Optional undefined properties are omitted consistently in storage and backups.
  await putSetting(COACHED_GAME_SETTING, JSON.parse(JSON.stringify(valid)) as JsonValue);
}

export async function loadCoachedGame(): Promise<CoachedGame | null> {
  const value = await getSetting(COACHED_GAME_SETTING);
  return value === undefined ? null : validateCoachedGame(value);
}
