import { Chess } from "chess.js";

import { canonicalEpd, prepareLichessPuzzle } from "./chess";
import type { MoveAssessment } from "./coaching";
import type { OpeningFamily } from "./curriculum";
import type { JsonValue, PreparedPuzzle, ReviewCardRecord, ReviewEvent, ReviewGrade } from "./types";

/** The shipped CC0 pack is deliberately kept separate from its prepared position. */
export interface CoachPackPuzzle {
  id: string;
  fenBeforeOpponentMove: string;
  moves: string[];
  rating: number;
  ratingDeviation: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
  openingFamily?: OpeningFamily;
  openingTag?: string;
  explanation?: string;
  source?: { url?: string };
}

export interface PracticePuzzle {
  puzzle: PreparedPuzzle;
  explanation?: string;
}

export interface PracticeSelection {
  positions: PracticePuzzle[];
  /** Reveal only after the attempt: this would give away the intended motif. */
  connection: string;
}

export function verifiedPracticeTheme(assessment?: MoveAssessment): "fork" | "mate" | undefined {
  if (assessment?.confidence !== "verified") return undefined;
  if (assessment.evidence.some((item) => item.kind === "knight-fork")) return "fork";
  if (assessment.evidence.some((item) => item.kind === "checkmate")) return "mate";
  return undefined;
}

/** Exactly two distinct legal positions, or no session. Never invent a motif from a score. */
export function selectCoachPractice(
  rows: readonly CoachPackPuzzle[],
  rating: number,
  family?: OpeningFamily,
  assessment?: MoveAssessment,
  history: { dueIds?: readonly string[]; recentIds?: readonly string[] } = {},
): PracticeSelection {
  const target = Number.isFinite(rating) ? rating : 1200;
  const theme = verifiedPracticeTheme(assessment);
  const due = new Set(history.dueIds ?? []);
  const recent = new Set(history.recentIds ?? []);
  const ranked = rows.filter((row) => row && typeof row === "object" && typeof row.id === "string" && Number.isFinite(row.rating)
    && Array.isArray(row.themes) && row.themes.every((theme) => typeof theme === "string")
    && Array.isArray(row.moves) && row.moves.every((move) => typeof move === "string")).map((row) => ({
    row,
    related: Boolean(theme && row.themes.includes(theme) && Math.abs(row.rating - target) <= 400),
  })).sort((a, b) => Number(due.has(b.row.id)) - Number(due.has(a.row.id))
    || Number(recent.has(a.row.id)) - Number(recent.has(b.row.id))
    || Number(b.related) - Number(a.related)
    || (Math.abs(a.row.rating - target) + (family && a.row.openingFamily !== family ? 45 : 0))
      - (Math.abs(b.row.rating - target) + (family && b.row.openingFamily !== family ? 45 : 0))
    || a.row.id.localeCompare(b.row.id));
  const positions: PracticePuzzle[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  let relatedCount = 0;
  for (const { row, related } of ranked) {
    if (ids.has(row.id)) continue;
    try {
      const puzzle = prepareLichessPuzzle({
        id: row.id, fen: row.fenBeforeOpponentMove, moves: row.moves,
        rating: row.rating, ratingDeviation: row.ratingDeviation,
        popularity: row.popularity, plays: row.nbPlays, themes: row.themes,
        gameUrl: row.source?.url ?? "", openingTags: row.openingTag?.split(" ") ?? [],
      });
      if (keys.has(puzzle.startKey) || new Chess(puzzle.startFen).isGameOver()) continue;
      ids.add(puzzle.id); keys.add(puzzle.startKey);
      positions.push({ puzzle, explanation: row.explanation });
      if (related) relatedCount++;
      if (positions.length === 2) break;
    } catch { /* A damaged row must not prevent a legal local exercise. */ }
  }
  if (positions.length !== 2) return { positions: [], connection: "Two distinct legal positions were not available in the installed pack." };
  const ratingNote = positions.some(({ puzzle }) => due.has(puzzle.id))
    ? "Due reviews take priority, so their original difficulty may differ from your current rating."
    : positions.every(({ puzzle }) => Math.abs(puzzle.rating - target) <= 400)
      ? "Selected near your current rating."
      : "The pack had limited suitable positions, so the nearest available difficulties are used.";
  return {
    positions,
    connection: (relatedCount === 2
      ? `Both positions are tagged ${theme === "fork" ? "fork" : "mate"} in the Lichess corpus, related to the verified pattern in your game.`
      : relatedCount === 1
        ? "One related position and one mixed calculation exercise were selected."
        : assessment
          ? "These are mixed calculation exercises, not a claim that your game mistake had a specific tactical motif."
          : "Two mixed calculation exercises.") + ` ${ratingNote}`,
  };
}

export interface SavedPracticeDecision {
  cardId: string;
  itemId: string;
  fen: string;
  context: Record<string, JsonValue>;
  explanation?: string;
  family?: OpeningFamily;
}

/** Older review screens sometimes omitted context fields: recover those without mutating history. */
export function savedPracticeDecision(card: ReviewCardRecord, events: readonly ReviewEvent[]): SavedPracticeDecision | null {
  if (card.kind !== "custom") return null;
  const relevant = events.filter((event) => event.cardId === card.id)
    .sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
  let context: Record<string, JsonValue> | null = null;
  let key: string | null = null;
  for (const event of relevant) {
    const next = event.context;
    if (!next || typeof next !== "object" || Array.isArray(next) || typeof next.fen !== "string") continue;
    try {
      const nextKey = canonicalEpd(next.fen);
      context = nextKey === key ? { ...(context ?? {}), ...next } : { ...next };
      key = nextKey;
    } catch { /* Malformed historical records remain stored, but are not playable. */ }
  }
  if (!context || typeof context.fen !== "string") return null;
  try { if (new Chess(context.fen).isGameOver()) return null; } catch { return null; }
  return {
    cardId: card.id, itemId: card.itemId, fen: context.fen, context,
    ...(typeof context.explanation === "string" ? { explanation: context.explanation } : {}),
    ...(context.family === "pirc" || context.family === "kid" || context.family === "kia" ? { family: context.family } : {}),
  };
}

/** A legal move alone is not a successful recall; an unstable search is not a failure. */
export function savedPracticeGrade(assessment: MoveAssessment): ReviewGrade | null {
  switch (assessment.classification) {
    case "best": case "excellent": case "good": return 3;
    case "inaccuracy": return 2;
    case "mistake": case "blunder": return 1;
    default: return null;
  }
}

export function savedPracticeReviewContext(item: SavedPracticeDecision, assessment: MoveAssessment): Record<string, JsonValue> {
  return { ...item.context, lastRetryMove: assessment.playedMove, lastRetryClassification: assessment.classification };
}
