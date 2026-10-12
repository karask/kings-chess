import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_REVIEW_SEPARATION_MS,
  allocateAdaptivePuzzleMix,
  buildAdaptivePuzzlePlan,
  buildDailySessionPlan,
  calculateAdaptivePuzzleBand,
  decideTacticsCardEnrollment,
  evaluateOpeningMastery,
  rankWeakThemes,
  shouldEnrollTacticsCard,
  summarizeProgress,
  type OpeningReviewAttempt,
} from "../lib/learning";

const DAY = MIN_REVIEW_SEPARATION_MS;

function successfulReviews(
  positionIds: readonly string[],
  reviewedAt: readonly number[] = [0, DAY],
): OpeningReviewAttempt[] {
  return positionIds.flatMap((positionId) =>
    reviewedAt.map((timestamp) => ({
      positionId,
      reviewedAt: timestamp,
      correct: true,
    })),
  );
}

test("opens the mastery gate at 85% retained positions with separated reviews", () => {
  const corePositionIds = Array.from({ length: 20 }, (_, index) => `p${index}`);
  const retainedPositionIds = corePositionIds.slice(0, 17);
  const summary = evaluateOpeningMastery({
    corePositionIds,
    introducedPositionIds: corePositionIds,
    reviewAttempts: successfulReviews(retainedPositionIds),
  });

  assert.equal(summary.retentionRate, 0.85);
  assert.equal(summary.retainedCorePositions, 17);
  assert.equal(summary.mastered, true);
  assert.deepEqual(summary.blockers, []);
  assert.deepEqual(summary.needsRecallPositionIds, corePositionIds.slice(17));
});

test("requires successful recalls to be at least seven days apart", () => {
  const sameDay = evaluateOpeningMastery({
    corePositionIds: ["pirc"],
    introducedPositionIds: ["pirc"],
    reviewAttempts: successfulReviews(["pirc"], [1_000, DAY]),
  });
  const separated = evaluateOpeningMastery({
    corePositionIds: ["pirc"],
    introducedPositionIds: ["pirc"],
    reviewAttempts: successfulReviews(["pirc"], [1_000, DAY + 1_000]),
  });

  assert.equal(sameDay.mastered, false);
  assert.deepEqual(sameDay.blockers, ["insufficient-delayed-recall"]);
  assert.equal(separated.mastered, true);
});

test("requires every core position to be introduced even after strong recall", () => {
  const summary = evaluateOpeningMastery({
    corePositionIds: ["kia", "pirc"],
    introducedPositionIds: ["kia"],
    reviewAttempts: successfulReviews(["kia", "pirc"]),
  });

  assert.equal(summary.retentionRate, 1);
  assert.equal(summary.coverageRate, 0.5);
  assert.equal(summary.mastered, false);
  assert.deepEqual(summary.blockers, ["positions-not-introduced"]);
});

test("builds deterministic foundation and maintenance sessions", () => {
  const foundation = buildDailySessionPlan({
    availableMinutes: 30,
    phase: "foundation",
  });
  const maintenance = buildDailySessionPlan({
    availableMinutes: 30,
    phase: "maintenance",
    hasGameToReview: true,
  });

  assert.deepEqual(foundation.blocks, [
    { activity: "opening-recall", minutes: 5 },
    { activity: "opening-lesson", minutes: 7 },
    { activity: "tactics", minutes: 8 },
    { activity: "position-sparring", minutes: 7 },
    { activity: "family-essential", minutes: 3 },
  ]);
  assert.deepEqual(maintenance.blocks, [
    { activity: "opening-recall", minutes: 4 },
    { activity: "tactics", minutes: 10 },
    { activity: "game-review", minutes: 10 },
    { activity: "family-essential", minutes: 6 },
  ]);
  assert.equal(
    foundation.blocks.reduce((sum, block) => sum + block.minutes, 0),
    30,
  );
  assert.equal(
    maintenance.blocks.reduce((sum, block) => sum + block.minutes, 0),
    30,
  );
});

test("enrolls tactic misses, hints, incomplete lines, and explicit saves", () => {
  const cleanSolve = {
    solved: true,
    firstAttemptCorrect: true,
    completedLine: true,
    usedHint: false,
  };
  const hintedSolve = { ...cleanSolve, usedHint: true };
  const slowSolve = { ...cleanSolve, durationMs: 120_000 };
  const skippedLine = {
    ...cleanSolve,
    solved: false,
    completedLine: false,
  };

  assert.deepEqual(decideTacticsCardEnrollment(cleanSolve), {
    action: "skip",
    shouldBeEnrolled: false,
    isNewEnrollment: false,
    reasons: [],
  });
  assert.equal(shouldEnrollTacticsCard(hintedSolve), true);
  assert.equal(shouldEnrollTacticsCard(slowSolve), true);
  assert.deepEqual(decideTacticsCardEnrollment(skippedLine).reasons, [
    "not-solved",
    "incomplete-line",
  ]);
  assert.deepEqual(decideTacticsCardEnrollment(hintedSolve).reasons, [
    "hint-used",
  ]);
  assert.deepEqual(
    decideTacticsCardEnrollment({ ...cleanSolve, alreadyEnrolled: true }),
    {
      action: "retain",
      shouldBeEnrolled: true,
      isNewEnrollment: false,
      reasons: ["already-enrolled"],
    },
  );
});

test("moves puzzle difficulty only after a meaningful recent sample", () => {
  assert.deepEqual(
    calculateAdaptivePuzzleBand({
      currentRating: 1_400,
      recentResults: [true, true, true, true],
    }),
    {
      minimum: 1_300,
      target: 1_400,
      maximum: 1_550,
      direction: "steady",
      sampleSize: 4,
      recentAccuracy: 1,
    },
  );

  const stronger = calculateAdaptivePuzzleBand({
    currentRating: 1_400,
    recentResults: [true, true, true, true, true, true, true, true, true, false],
  });
  const struggling = calculateAdaptivePuzzleBand({
    currentRating: 1_400,
    recentResults: [false, false, true, false, true],
  });

  assert.deepEqual(
    { target: stronger.target, direction: stronger.direction },
    { target: 1_475, direction: "up" },
  );
  assert.deepEqual(
    { target: struggling.target, direction: struggling.direction },
    { target: 1_300, direction: "down" },
  );
});

test("ranks weak themes and allocates the 70/20/10 puzzle mix", () => {
  const ranked = rankWeakThemes([
    { theme: "pin", attempts: 8, correct: 4, recentMisses: 2 },
    { theme: "fork", attempts: 4, correct: 1, recentMisses: 1 },
    { theme: "skewer", attempts: 2, correct: 1, recentMisses: 1 },
    { theme: "clearance", attempts: 1, correct: 0, recentMisses: 1 },
  ]);

  assert.deepEqual(
    ranked.map(({ theme }) => theme),
    ["fork", "pin", "skewer"],
  );
  assert.deepEqual(allocateAdaptivePuzzleMix(10, ["fork", "pin"]), {
    total: 10,
    weakness: 7,
    mixed: 2,
    stretch: 1,
    weakThemes: ["fork", "pin"],
  });
  assert.deepEqual(allocateAdaptivePuzzleMix(10, []), {
    total: 10,
    weakness: 0,
    mixed: 9,
    stretch: 1,
    weakThemes: [],
  });
});

test("combines rating and weakness signals into an adaptive puzzle plan", () => {
  const plan = buildAdaptivePuzzlePlan({
    currentRating: 1_200,
    recentResults: [true, true, true, true, true],
    puzzleCount: 10,
    themePerformance: [
      { theme: "fork", attempts: 5, correct: 2 },
      { theme: "pin", attempts: 5, correct: 4 },
    ],
  });

  assert.equal(plan.band.target, 1_275);
  assert.equal(plan.mix.weakness, 7);
  assert.deepEqual(
    plan.weakThemes.map(({ theme }) => theme),
    ["fork", "pin"],
  );
});

test("summarizes opening, tactics, and reviewed-game progress", () => {
  const openingMastery = evaluateOpeningMastery({
    corePositionIds: ["kia", "pirc"],
    introducedPositionIds: ["kia", "pirc"],
    reviewAttempts: successfulReviews(["kia", "pirc"]),
  });
  const summary = summarizeProgress({
    openingMastery,
    enrolledTacticsCards: 3,
    tacticsAttempts: [
      { correct: false, themes: ["fork"] },
      { correct: true, themes: ["fork", "pin"] },
      { correct: true, themes: ["pin"] },
      { correct: true, themes: ["discovery"] },
    ],
    games: [
      { moves: 40, blunders: 2 },
      { moves: 60, blunders: 1 },
    ],
  });

  assert.equal(summary.phase, "maintenance");
  assert.equal(summary.focus, "balanced-maintenance");
  assert.deepEqual(summary.opening, {
    coveragePercent: 100,
    retentionPercent: 100,
    retainedPositions: 2,
    totalPositions: 2,
  });
  assert.deepEqual(summary.tactics, {
    attempts: 4,
    correct: 3,
    accuracyPercent: 75,
    enrolledCards: 3,
    weakThemes: ["fork", "pin"],
  });
  assert.deepEqual(summary.games, {
    reviewed: 2,
    moves: 100,
    blunders: 3,
    blundersPer100Moves: 3,
  });
});
