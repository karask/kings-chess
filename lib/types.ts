import type { Card as FsrsCard } from "ts-fsrs";

export type ChessColor = "w" | "b";
export type ChessFile = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type ChessRank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type ChessSquare = `${ChessFile}${ChessRank}`;
export type PromotionPiece = "q" | "r" | "b" | "n";

/** A coordinate move such as e2e4 or e7e8q. Runtime helpers validate it. */
export type UciMove = string;

/**
 * The first four fields of a normalized FEN. Half-move/full-move clocks are
 * intentionally omitted so positions reached by transposition share a key.
 */
export type CanonicalEpd = string;

export interface ParsedUciMove {
  from: ChessSquare;
  to: ChessSquare;
  promotion?: PromotionPiece;
}

export interface AppliedChessMove {
  uci: UciMove;
  san: string;
  beforeFen: string;
  afterFen: string;
  beforeKey: CanonicalEpd;
  afterKey: CanonicalEpd;
  isCheck: boolean;
  isCheckmate: boolean;
}

/** Normalized representation of one row in the public Lichess puzzle CSV. */
export interface LichessPuzzle {
  id: string;
  fen: string;
  /** Includes Lichess's initial opponent move at index 0. */
  moves: UciMove[];
  rating: number;
  ratingDeviation: number;
  popularity: number;
  plays: number;
  themes: string[];
  gameUrl: string;
  openingTags: string[];
}

export interface PreparedPuzzle extends LichessPuzzle {
  /** The source position before Lichess's initial opponent move. */
  sourceFen: string;
  sourceKey: CanonicalEpd;
  initialMove: UciMove;
  initialMoveSan: string;
  /** Position shown to the learner, after the initial opponent move. */
  startFen: string;
  startKey: CanonicalEpd;
  playerColor: ChessColor;
  /** The solution from the learner's first move onward. */
  solution: UciMove[];
  solutionSans: string[];
}

export type PuzzleSessionStatus = "active" | "solved";

export interface PuzzleSession {
  puzzle: PreparedPuzzle;
  fen: string;
  /** Index of the next learner move in puzzle.solution. */
  cursor: number;
  status: PuzzleSessionStatus;
  mistakes: number;
  hints: number;
  playedMoves: UciMove[];
}

export type PuzzleMoveVerdict =
  | "correct"
  | "alternate-mate"
  | "incorrect"
  | "illegal"
  | "already-solved";

export interface PuzzleMoveResult {
  verdict: PuzzleMoveVerdict;
  accepted: boolean;
  complete: boolean;
  expectedMove?: UciMove;
  playedMove?: UciMove;
  opponentMove?: UciMove;
  session: PuzzleSession;
}

/** Numeric values intentionally match ts-fsrs Rating.Again..Rating.Easy. */
export type ReviewGrade = 1 | 2 | 3 | 4;
export type TrainingItemKind = "opening" | "tactic" | "essential" | "custom";

export interface RepertoireMove {
  uci: UciMove;
  san: string;
  turn: ChessColor;
  fromKey: CanonicalEpd;
  toKey: CanonicalEpd;
  toFen: string;
  mainline: boolean;
  comments: string[];
  nags: string[];
  gameIndexes: number[];
}

export interface RepertoirePosition {
  key: CanonicalEpd;
  fen: string;
  turn: ChessColor;
  minPly: number;
  moves: RepertoireMove[];
}

export interface RepertoireGame {
  index: number;
  rootKey: CanonicalEpd;
  rootFen: string;
  tags: Record<string, string>;
  mainlinePlies: number;
}

export interface Repertoire {
  id: string;
  name: string;
  playerColor: ChessColor | "both";
  rootKeys: CanonicalEpd[];
  positions: Record<CanonicalEpd, RepertoirePosition>;
  games: RepertoireGame[];
}

export interface ParseRepertoireOptions {
  id?: string;
  name?: string;
  playerColor?: ChessColor | "both";
}

export interface RepertoireMoveMatch {
  matched: boolean;
  position?: RepertoirePosition;
  move?: RepertoireMove;
  reason?: "position-not-found" | "move-not-found" | "illegal-move";
}

export interface RepertoireWalkResult {
  matched: boolean;
  finalFen: string;
  finalKey: CanonicalEpd;
  matchedMoves: RepertoireMove[];
  failedAt?: number;
  reason?: RepertoireMoveMatch["reason"];
}

/** Stable authored edge in the shipped, transposition-aware repertoire graph. */
export interface MoveEdge {
  schemaVersion: 1;
  id: string;
  fromNodeId: string;
  toNodeId: string;
  uci: UciMove;
  san: string;
  role: "learner" | "opponent";
  accepted: boolean;
  mainline: boolean;
}

/** Instruction lives on canonical positions, while move order lives on edges. */
export interface PositionNode {
  schemaVersion: 1;
  id: string;
  epd: CanonicalEpd;
  fen: string;
  family: "pirc" | "kid" | "kia";
  acceptedMoveEdgeIds: string[];
  opponentPlans: string[];
  pawnBreaks: string[];
  warnings: string[];
  concepts: string[];
  modelGameIds: string[];
}

/** Versioned runtime record produced from one CC0 Lichess puzzle row. */
export interface PuzzleRecord {
  schemaVersion: 1;
  id: string;
  sourceFen: string;
  setupMove: UciMove;
  solution: UciMove[];
  rating: number;
  ratingDeviation: number;
  popularity: number;
  plays: number;
  themes: string[];
  openingTags: string[];
  source: {
    provider: "lichess";
    snapshot: string;
    url: string;
    license: "CC0-1.0";
  };
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ReviewCardRecord {
  id: string;
  itemId: string;
  kind: TrainingItemKind;
  card: FsrsCard;
  /** Duplicated from card.due so IndexedDB can index it directly. */
  due: Date;
  state: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Sync-compatible v1 envelope for a scheduled training card. */
export interface TrainingCard extends ReviewCardRecord {
  schemaVersion: 1;
}

export interface ReviewEvent {
  schemaVersion: 1;
  id: string;
  cardId: string;
  itemId: string;
  kind: TrainingItemKind;
  grade: ReviewGrade;
  reviewedAt: Date;
  durationMs?: number;
  source?: string;
  context?: JsonValue;
  schedulerVersion: string;
  previousCard: FsrsCard;
  nextCard: FsrsCard;
}

export interface TrainingAttempt {
  id: string;
  itemId: string;
  kind: TrainingItemKind;
  startedAt: Date;
  finishedAt: Date;
  outcome: "solved" | "failed" | "abandoned";
  durationMs: number;
  mistakes?: number;
  hints?: number;
  metadata?: JsonValue;
}

export interface SettingRecord {
  key: string;
  value: JsonValue;
  updatedAt: Date;
}

export interface ContentManifest {
  schemaVersion: 1;
  id: string;
  kind: "puzzles" | "repertoire" | "curriculum" | "other";
  version: string;
  installedAt: Date;
  itemCount?: number;
  checksum?: string;
  metadata?: JsonValue;
}

export interface ImportedGame {
  schemaVersion: 1;
  id: string;
  importedAt: string;
  pgn: string;
  white?: string;
  black?: string;
  result?: string;
  learnerColor?: ChessColor;
}

export interface GameReviewResult {
  schemaVersion: 1;
  id: string;
  importedGameId: string;
  repertoirePositionIds: string[];
  firstDeparture?: {
    ply: number;
    fen: string;
    playedMove: UciMove;
  };
  criticalMoments: Array<{
    id: string;
    ply: number;
    fen: string;
    classification: "opening" | "tactic" | "strategy" | "endgame";
    learnerRetry?: UciMove;
    engine?: EngineAnalysis;
  }>;
  generatedAt: string;
}

export interface ReviewCardOptions {
  itemId?: string;
  kind?: TrainingItemKind;
  reviewedAt?: Date;
  durationMs?: number;
  source?: string;
  context?: JsonValue;
}

export interface ReviewResult {
  card: ReviewCardRecord;
  event: ReviewEvent;
}

export interface SerializedFsrsCard
  extends Omit<FsrsCard, "due" | "last_review"> {
  due: string;
  last_review?: string;
}

export interface SerializedReviewCardRecord
  extends Omit<ReviewCardRecord, "card" | "due" | "createdAt" | "updatedAt"> {
  card: SerializedFsrsCard;
  due: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedReviewEvent
  extends Omit<ReviewEvent, "reviewedAt" | "previousCard" | "nextCard"> {
  reviewedAt: string;
  previousCard: SerializedFsrsCard;
  nextCard: SerializedFsrsCard;
}

export interface SerializedTrainingAttempt
  extends Omit<TrainingAttempt, "startedAt" | "finishedAt"> {
  startedAt: string;
  finishedAt: string;
}

export interface SerializedSettingRecord extends Omit<SettingRecord, "updatedAt"> {
  updatedAt: string;
}

export interface SerializedContentManifest
  extends Omit<ContentManifest, "installedAt"> {
  installedAt: string;
}

export interface ChessTrainerBackup {
  format: "kings-study-backup";
  schemaVersion: number;
  exportedAt: string;
  data: {
    reviewCards: SerializedReviewCardRecord[];
    reviewEvents: SerializedReviewEvent[];
    attempts: SerializedTrainingAttempt[];
    settings: SerializedSettingRecord[];
    contentManifests: SerializedContentManifest[];
  };
}

/** Public contract name used by backup/export integrations. */
export type BackupEnvelope = ChessTrainerBackup;

export type BackupRestoreMode = "merge" | "replace";

export interface BackupRestoreResult {
  mode: BackupRestoreMode;
  cards: number;
  eventsAdded: number;
  eventsSkipped: number;
  attempts: number;
  settings: number;
  contentManifests: number;
}

export type EngineStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "disposed";

export interface EngineScore {
  type: "cp" | "mate";
  value: number;
  bound?: "lower" | "upper";
}

export interface EnginePrincipalVariation {
  multipv: number;
  depth: number;
  selectiveDepth?: number;
  score?: EngineScore;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  pv: UciMove[];
}

export interface EngineAnalysis {
  generation: number;
  fen: string;
  perspective: ChessColor;
  bestMove: UciMove | null;
  ponderMove: UciMove | null;
  /** Latest scored PVs, which may be bounds from an unfinished search iteration. */
  lines: EnginePrincipalVariation[];
  /** Last unbounded scored PV per MultiPV index. Roots may differ from bestMove. */
  completedLines?: EnginePrincipalVariation[];
  elapsedMs: number;
}

export interface EngineSearchOptions {
  depth?: number;
  moveTimeMs?: number;
  nodes?: number;
  multiPv?: number;
  /** Full move history, required for repetition-aware full-game analysis. */
  history?: { initialFen: string; moves: UciMove[] };
  /** Opponent difficulty only. Every omitted value resets Stockfish to strength 20. */
  skillLevel?: number;
  /** Restrict analysis to these legal root moves, e.g. to evaluate the move played. */
  searchMoves?: UciMove[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onInfo?: (line: EnginePrincipalVariation, allLines: EnginePrincipalVariation[]) => void;
}

export interface StockfishClientOptions {
  workerUrl?: string;
  engineUrl?: string;
  initializationTimeoutMs?: number;
}
