import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { createEmptyCard } from "ts-fsrs";

import { canonicalEpd } from "../lib/chess";
import { savedPracticeDecision, savedPracticeGrade, savedPracticeReviewContext, selectCoachPractice, verifiedPracticeTheme, type CoachPackPuzzle } from "../lib/coach-practice";
import type { MoveAssessment } from "../lib/coaching";
import { starterTactics } from "../lib/puzzles";
import type { ReviewCardRecord, ReviewEvent } from "../lib/types";

const rows: CoachPackPuzzle[] = starterTactics.map((puzzle) => ({ ...puzzle, moves: [...puzzle.moves], themes: [...puzzle.themes], source: { url: "https://lichess.org/example" } }));
const fen = new Chess().fen();
const assessment: MoveAssessment = {
  beforeFen: fen, playedMove: "e2e4", playedSan: "e4", bestMove: "e2e4", bestSan: "e4", title: "Best",
  classification: "best", confidence: "verified", explanation: "Stored explanation.", bestLine: ["e2e4"], playedLine: ["e2e4"], evidence: [],
};
const now = new Date("2026-10-12T12:00:00Z");
const card: ReviewCardRecord = { id: "custom:1", itemId: "moment:1", kind: "custom", card: createEmptyCard(now), due: now, state: 0, createdAt: now, updatedAt: now };
function event(context: ReviewEvent["context"], seconds = 0): ReviewEvent {
  return { schemaVersion: 1, id: `event:${seconds}`, cardId: card.id, itemId: card.itemId, kind: "custom", grade: 1, reviewedAt: new Date(now.getTime() + seconds * 1000), context, schedulerVersion: "test", previousCard: createEmptyCard(now), nextCard: createEmptyCard(now) };
}

test("practice selection gives exactly two unique legal post-opponent positions", () => {
  const chosen = selectCoachPractice(rows, 1100);
  assert.equal(chosen.positions.length, 2);
  assert.notEqual(chosen.positions[0].puzzle.id, chosen.positions[1].puzzle.id);
  assert.notEqual(chosen.positions[0].puzzle.startKey, chosen.positions[1].puzzle.startKey);
  for (const { puzzle } of chosen.positions) {
    const board = new Chess(puzzle.sourceFen);
    board.move({ from: puzzle.initialMove.slice(0, 2), to: puzzle.initialMove.slice(2, 4), promotion: puzzle.initialMove[4] });
    assert.equal(board.fen(), puzzle.startFen);
    assert.equal(puzzle.playerColor, board.turn());
    assert.equal(puzzle.solution.length % 2, 1);
  }
});

test("duplicate source positions and malformed rows do not become a two-position session", () => {
  assert.deepEqual(selectCoachPractice([rows[0], { ...rows[0], id: "duplicate" }, { ...rows[1], fenBeforeOpponentMove: "broken" }], 1200).positions, []);
});

test("only verified specific evidence requests a motif; material alone does not", () => {
  assert.equal(verifiedPracticeTheme({ ...assessment, evidence: [{ kind: "material", text: "A piece was lost", squares: [] }] }), undefined);
  assert.equal(verifiedPracticeTheme({ ...assessment, confidence: "limited", evidence: [{ kind: "knight-fork", text: "Fork", squares: [] }] }), undefined);
  assert.equal(verifiedPracticeTheme({ ...assessment, evidence: [{ kind: "knight-fork", text: "Fork", squares: [] }] }), "fork");
  assert.equal(verifiedPracticeTheme({ ...assessment, evidence: [{ kind: "checkmate", text: "Mate", squares: [] }] }), "mate");
  assert.match(selectCoachPractice(rows, 900, undefined, assessment).connection, /mixed/);
});

test("targeted practice is labeled related only if both positions match", () => {
  const selected = selectCoachPractice(rows, 900, undefined, { ...assessment, evidence: [{ kind: "checkmate", text: "Mate", squares: [] }] });
  assert.equal(selected.positions.length, 2);
  assert.ok(selected.positions.every(({ puzzle }) => puzzle.themes.includes("mate")));
  assert.match(selected.connection, /Both positions are tagged mate/);
});

test("recent practice rotates to fresh positions while due tactics get first priority", () => {
  const first = selectCoachPractice(rows, 1100);
  const recentIds = first.positions.map(({ puzzle }) => puzzle.id);
  const second = selectCoachPractice(rows, 1100, undefined, undefined, { recentIds });
  assert.ok(second.positions.every(({ puzzle }) => !recentIds.includes(puzzle.id)));
  const withDue = selectCoachPractice(rows, 1100, undefined, undefined, { recentIds, dueIds: [recentIds[0]] });
  assert.equal(withDue.positions[0].puzzle.id, recentIds[0]);
  assert.equal(withDue.positions.length, 2);
});

test("saved decision preserves original lesson across sparse later review events", () => {
  const original = { fen, explanation: "Do not leave e4 undefended.", bestMove: "e2e4", gameId: "original-game", family: "kia", classification: "strategy" };
  const latest = { fen, rationale: "Recalculate this position", lastRetryMove: "d2d4" };
  const item = savedPracticeDecision(card, [event(latest, 10), event(original)]);
  assert.ok(item);
  assert.equal(item.explanation, original.explanation);
  assert.equal(item.family, "kia");
  const next = savedPracticeReviewContext(item, { ...assessment, playedMove: "g1f3" });
  assert.equal(next.explanation, original.explanation);
  assert.equal(next.bestMove, "e2e4");
  assert.equal(next.gameId, "original-game");
  assert.equal(next.lastRetryMove, "g1f3");
  assert.equal(item.context.lastRetryMove, "d2d4", "source context is immutable");
});

test("saved context does not carry an explanation into a different position or invent a family", () => {
  const board = new Chess(); board.move("e4");
  const item = savedPracticeDecision(card, [event({ fen, explanation: "For the old position", family: "kia" }), event({ fen: board.fen() }, 10)]);
  assert.ok(item);
  assert.equal(canonicalEpd(item.fen), canonicalEpd(board.fen()));
  assert.equal(item.explanation, undefined);
  assert.equal(item.family, undefined);
  assert.equal(savedPracticeDecision(card, [event({ fen: "bad" })]), null);
});

test("recall grading uses move quality, not legality or exact preferred move", () => {
  for (const classification of ["best", "excellent", "good"] as const) assert.equal(savedPracticeGrade({ ...assessment, classification }), 3);
  assert.equal(savedPracticeGrade({ ...assessment, classification: "inaccuracy" }), 2);
  for (const classification of ["mistake", "blunder"] as const) assert.equal(savedPracticeGrade({ ...assessment, classification }), 1);
  assert.equal(savedPracticeGrade({ ...assessment, classification: "unrated" }), null);
});
