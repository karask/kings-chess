export const OPENING_MASTERY_THRESHOLD = 0.85;
export const REQUIRED_SEPARATED_SUCCESSES = 2;
export const MIN_REVIEW_SEPARATION_MS = 7 * 24 * 60 * 60 * 1_000;

export type LearningPhase = "foundation" | "maintenance";

export interface OpeningReviewAttempt {
  positionId: string;
  reviewedAt: number;
  correct: boolean;
}

export interface OpeningMasteryInput {
  corePositionIds: readonly string[];
  introducedPositionIds: readonly string[];
  reviewAttempts: readonly OpeningReviewAttempt[];
  threshold?: number;
  requiredSeparatedSuccesses?: number;
  minReviewSeparationMs?: number;
}

export type MasteryBlocker =
  | "no-core-positions"
  | "positions-not-introduced"
  | "insufficient-delayed-recall";

export interface OpeningMasterySummary {
  mastered: boolean;
  totalCorePositions: number;
  introducedCorePositions: number;
  retainedCorePositions: number;
  coverageRate: number;
  retentionRate: number;
  threshold: number;
  requiredSeparatedSuccesses: number;
  minReviewSeparationMs: number;
  notIntroducedPositionIds: string[];
  needsRecallPositionIds: string[];
  blockers: MasteryBlocker[];
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function assertNonEmptyId(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function uniqueIds(ids: readonly string[], name: string): string[] {
  ids.forEach((id, index) => assertNonEmptyId(id, `${name}[${index}]`));
  return [...new Set(ids)];
}

function separatedSuccessCount(
  timestamps: readonly number[],
  minSeparationMs: number,
): number {
  let count = 0;
  let lastAcceptedAt = Number.NEGATIVE_INFINITY;

  for (const reviewedAt of [...timestamps].sort((a, b) => a - b)) {
    if (reviewedAt - lastAcceptedAt >= minSeparationMs) {
      count += 1;
      lastAcceptedAt = reviewedAt;
    }
  }

  return count;
}

/**
 * A core position is retained only after successful recalls separated in time.
 * The foundation gate opens when every core position has been introduced and
 * the configured share of core positions is retained.
 */
export function evaluateOpeningMastery(
  input: OpeningMasteryInput,
): OpeningMasterySummary {
  const threshold = input.threshold ?? OPENING_MASTERY_THRESHOLD;
  const requiredSeparatedSuccesses =
    input.requiredSeparatedSuccesses ?? REQUIRED_SEPARATED_SUCCESSES;
  const minReviewSeparationMs =
    input.minReviewSeparationMs ?? MIN_REVIEW_SEPARATION_MS;

  assertFiniteNumber(threshold, "threshold");
  if (threshold <= 0 || threshold > 1) {
    throw new RangeError("threshold must be greater than 0 and at most 1");
  }
  if (
    !Number.isInteger(requiredSeparatedSuccesses) ||
    requiredSeparatedSuccesses < 1
  ) {
    throw new RangeError(
      "requiredSeparatedSuccesses must be a positive integer",
    );
  }
  assertFiniteNumber(minReviewSeparationMs, "minReviewSeparationMs");
  if (minReviewSeparationMs < 0) {
    throw new RangeError("minReviewSeparationMs must be non-negative");
  }

  const corePositionIds = uniqueIds(input.corePositionIds, "corePositionIds");
  const introducedIds = new Set(
    uniqueIds(input.introducedPositionIds, "introducedPositionIds"),
  );
  const coreIds = new Set(corePositionIds);
  const successfulReviews = new Map<string, number[]>();

  for (const [index, attempt] of input.reviewAttempts.entries()) {
    assertNonEmptyId(attempt.positionId, `reviewAttempts[${index}].positionId`);
    assertFiniteNumber(
      attempt.reviewedAt,
      `reviewAttempts[${index}].reviewedAt`,
    );
    if (!coreIds.has(attempt.positionId) || !attempt.correct) {
      continue;
    }

    const timestamps = successfulReviews.get(attempt.positionId) ?? [];
    timestamps.push(attempt.reviewedAt);
    successfulReviews.set(attempt.positionId, timestamps);
  }

  const notIntroducedPositionIds = corePositionIds.filter(
    (positionId) => !introducedIds.has(positionId),
  );
  const retainedIds = new Set(
    corePositionIds.filter(
      (positionId) =>
        separatedSuccessCount(
          successfulReviews.get(positionId) ?? [],
          minReviewSeparationMs,
        ) >= requiredSeparatedSuccesses,
    ),
  );
  const needsRecallPositionIds = corePositionIds.filter(
    (positionId) => !retainedIds.has(positionId),
  );
  const totalCorePositions = corePositionIds.length;
  const introducedCorePositions =
    totalCorePositions - notIntroducedPositionIds.length;
  const retainedCorePositions = retainedIds.size;
  const coverageRate =
    totalCorePositions === 0 ? 0 : introducedCorePositions / totalCorePositions;
  const retentionRate =
    totalCorePositions === 0 ? 0 : retainedCorePositions / totalCorePositions;
  const blockers: MasteryBlocker[] = [];

  if (totalCorePositions === 0) blockers.push("no-core-positions");
  if (coverageRate < 1) blockers.push("positions-not-introduced");
  if (retentionRate < threshold) blockers.push("insufficient-delayed-recall");

  return {
    mastered: totalCorePositions > 0 && blockers.length === 0,
    totalCorePositions,
    introducedCorePositions,
    retainedCorePositions,
    coverageRate,
    retentionRate,
    threshold,
    requiredSeparatedSuccesses,
    minReviewSeparationMs,
    notIntroducedPositionIds,
    needsRecallPositionIds,
    blockers,
  };
}

export function getLearningPhase(
  mastery: Pick<OpeningMasterySummary, "mastered">,
): LearningPhase {
  return mastery.mastered ? "maintenance" : "foundation";
}

export type SessionActivity =
  | "opening-recall"
  | "opening-lesson"
  | "tactics"
  | "position-sparring"
  | "game-review"
  | "family-essential";

export interface SessionBlock {
  activity: SessionActivity;
  minutes: number;
}

export interface DailySessionPlan {
  phase: LearningPhase;
  totalMinutes: number;
  blocks: SessionBlock[];
}

export interface DailySessionInput {
  availableMinutes: number;
  phase: LearningPhase;
  hasGameToReview?: boolean;
}

const FOUNDATION_WEIGHTS = [
  { activity: "opening-recall", share: 5 / 30 },
  { activity: "opening-lesson", share: 7 / 30 },
  { activity: "tactics", share: 8 / 30 },
  { activity: "position-sparring", share: 7 / 30 },
  { activity: "family-essential", share: 3 / 30 },
] as const;

const MAINTENANCE_WEIGHTS = [
  { activity: "opening-recall", share: 4 / 30 },
  { activity: "tactics", share: 10 / 30 },
  { activity: "position-sparring", share: 10 / 30 },
  { activity: "family-essential", share: 6 / 30 },
] as const;

interface WeightedItem<T> {
  item: T;
  share: number;
}

function allocateByLargestRemainder<T>(
  total: number,
  weightedItems: readonly WeightedItem<T>[],
): Array<{ item: T; count: number }> {
  assertNonNegativeInteger(total, "total");
  const shareTotal = weightedItems.reduce((sum, entry) => sum + entry.share, 0);
  if (Math.abs(shareTotal - 1) > 1e-9) {
    throw new RangeError("weights must sum to 1");
  }

  const allocations = weightedItems.map((entry, index) => {
    assertFiniteNumber(entry.share, `weights[${index}].share`);
    if (entry.share < 0) {
      throw new RangeError("weights must be non-negative");
    }
    const exact = total * entry.share;
    return {
      item: entry.item,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      index,
    };
  });
  let remaining = total - allocations.reduce((sum, entry) => sum + entry.count, 0);
  const remainderOrder = [...allocations].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );

  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    remainderOrder[index % remainderOrder.length].count += 1;
  }

  return allocations.map(({ item, count }) => ({ item, count }));
}

/** Builds a deterministic, whole-minute session from the phase weightings. */
export function buildDailySessionPlan(
  input: DailySessionInput,
): DailySessionPlan {
  if (
    !Number.isInteger(input.availableMinutes) ||
    input.availableMinutes < 10 ||
    input.availableMinutes > 180
  ) {
    throw new RangeError(
      "availableMinutes must be a whole number between 10 and 180",
    );
  }

  const weights =
    input.phase === "foundation" ? FOUNDATION_WEIGHTS : MAINTENANCE_WEIGHTS;
  const allocations = allocateByLargestRemainder(
    input.availableMinutes,
    weights.map(({ activity, share }) => ({ item: activity, share })),
  );
  const blocks = allocations
    .filter(({ count }) => count > 0)
    .map(({ item, count }) => ({
      activity:
        item === "position-sparring" && input.hasGameToReview
          ? ("game-review" as const)
          : item,
      minutes: count,
    }));

  return {
    phase: input.phase,
    totalMinutes: input.availableMinutes,
    blocks,
  };
}

export function buildSessionPlanForMastery(
  availableMinutes: number,
  mastery: Pick<OpeningMasterySummary, "mastered">,
  hasGameToReview = false,
): DailySessionPlan {
  return buildDailySessionPlan({
    availableMinutes,
    phase: getLearningPhase(mastery),
    hasGameToReview,
  });
}

export interface TacticsAttemptOutcome {
  solved: boolean;
  firstAttemptCorrect: boolean;
  completedLine: boolean;
  usedHint: boolean;
  durationMs?: number;
  slowThresholdMs?: number;
  userRequestedReview?: boolean;
  alreadyEnrolled?: boolean;
}

export type TacticsEnrollmentReason =
  | "not-solved"
  | "wrong-first-attempt"
  | "incomplete-line"
  | "hint-used"
  | "slow-solve"
  | "user-requested"
  | "already-enrolled";

export interface TacticsEnrollmentDecision {
  action: "enroll" | "retain" | "skip";
  shouldBeEnrolled: boolean;
  isNewEnrollment: boolean;
  reasons: TacticsEnrollmentReason[];
}

/**
 * Ordinary thinking time never penalizes accuracy. Misses, hints, incomplete
 * lines, unusually slow solves, and explicit saves create a review card.
 */
export function decideTacticsCardEnrollment(
  attempt: TacticsAttemptOutcome,
): TacticsEnrollmentDecision {
  const reasons: TacticsEnrollmentReason[] = [];

  if (!attempt.solved) reasons.push("not-solved");
  if (!attempt.firstAttemptCorrect) reasons.push("wrong-first-attempt");
  if (!attempt.completedLine) reasons.push("incomplete-line");
  if (attempt.usedHint) reasons.push("hint-used");
  if (
    attempt.solved &&
    attempt.completedLine &&
    attempt.durationMs !== undefined &&
    attempt.durationMs >= (attempt.slowThresholdMs ?? 120_000)
  ) reasons.push("slow-solve");
  if (attempt.userRequestedReview) reasons.push("user-requested");

  const hasLearningSignal = reasons.length > 0;
  if (attempt.alreadyEnrolled) reasons.push("already-enrolled");
  const shouldBeEnrolled = Boolean(attempt.alreadyEnrolled) || hasLearningSignal;

  return {
    action: attempt.alreadyEnrolled
      ? "retain"
      : hasLearningSignal
        ? "enroll"
        : "skip",
    shouldBeEnrolled,
    isNewEnrollment: !attempt.alreadyEnrolled && hasLearningSignal,
    reasons,
  };
}

export function shouldEnrollTacticsCard(
  attempt: TacticsAttemptOutcome,
): boolean {
  return decideTacticsCardEnrollment(attempt).isNewEnrollment;
}

export type PuzzleBandDirection = "down" | "steady" | "up";

export interface AdaptivePuzzleBandInput {
  currentRating: number;
  recentResults?: readonly boolean[];
  ratingFloor?: number;
  ratingCeiling?: number;
}

export interface AdaptivePuzzleBand {
  minimum: number;
  target: number;
  maximum: number;
  direction: PuzzleBandDirection;
  sampleSize: number;
  recentAccuracy: number | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Uses at most the ten latest results. Five results are required before the
 * band moves, avoiding noisy difficulty changes after one puzzle.
 */
export function calculateAdaptivePuzzleBand(
  input: AdaptivePuzzleBandInput,
): AdaptivePuzzleBand {
  const ratingFloor = input.ratingFloor ?? 400;
  const ratingCeiling = input.ratingCeiling ?? 3_200;
  assertFiniteNumber(input.currentRating, "currentRating");
  assertFiniteNumber(ratingFloor, "ratingFloor");
  assertFiniteNumber(ratingCeiling, "ratingCeiling");
  if (ratingFloor >= ratingCeiling) {
    throw new RangeError("ratingFloor must be lower than ratingCeiling");
  }

  const recentResults = [...(input.recentResults ?? [])].slice(-10);
  const recentAccuracy =
    recentResults.length === 0
      ? null
      : recentResults.filter(Boolean).length / recentResults.length;
  let direction: PuzzleBandDirection = "steady";
  let adjustment = 0;

  if (recentResults.length >= 5 && recentAccuracy !== null) {
    if (recentAccuracy < 0.6) {
      direction = "down";
      adjustment = -100;
    } else if (recentAccuracy >= 0.85) {
      direction = "up";
      adjustment = 75;
    }
  }

  const target = Math.round(
    clamp(input.currentRating + adjustment, ratingFloor, ratingCeiling),
  );

  return {
    minimum: Math.round(clamp(target - 100, ratingFloor, ratingCeiling)),
    target,
    maximum: Math.round(clamp(target + 150, ratingFloor, ratingCeiling)),
    direction,
    sampleSize: recentResults.length,
    recentAccuracy,
  };
}

export interface ThemePerformance {
  theme: string;
  attempts: number;
  correct: number;
  recentMisses?: number;
}

export interface RankedWeakTheme extends ThemePerformance {
  accuracyRate: number;
  misses: number;
}

export interface WeakThemeOptions {
  limit?: number;
  minimumAttempts?: number;
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function rankWeakThemes(
  performance: readonly ThemePerformance[],
  options: WeakThemeOptions = {},
): RankedWeakTheme[] {
  const limit = options.limit ?? 3;
  const minimumAttempts = options.minimumAttempts ?? 2;
  assertNonNegativeInteger(limit, "limit");
  assertNonNegativeInteger(minimumAttempts, "minimumAttempts");
  const seenThemes = new Set<string>();

  const ranked = performance.map((entry, index) => {
    assertNonEmptyId(entry.theme, `performance[${index}].theme`);
    if (seenThemes.has(entry.theme)) {
      throw new TypeError(`performance contains duplicate theme: ${entry.theme}`);
    }
    seenThemes.add(entry.theme);
    assertNonNegativeInteger(entry.attempts, `performance[${index}].attempts`);
    assertNonNegativeInteger(entry.correct, `performance[${index}].correct`);
    const recentMisses = entry.recentMisses ?? 0;
    assertNonNegativeInteger(
      recentMisses,
      `performance[${index}].recentMisses`,
    );
    if (entry.correct > entry.attempts) {
      throw new RangeError("correct cannot exceed attempts");
    }

    return {
      ...entry,
      recentMisses,
      accuracyRate:
        entry.attempts === 0 ? 1 : entry.correct / entry.attempts,
      misses: entry.attempts - entry.correct,
    };
  });

  return ranked
    .filter((entry) => entry.attempts >= minimumAttempts)
    .sort(
      (a, b) =>
        a.accuracyRate - b.accuracyRate ||
        (b.recentMisses ?? 0) - (a.recentMisses ?? 0) ||
        b.attempts - a.attempts ||
        lexicalCompare(a.theme, b.theme),
    )
    .slice(0, limit);
}

export interface PuzzleMix {
  total: number;
  weakness: number;
  mixed: number;
  stretch: number;
  weakThemes: string[];
}

/** Allocates 70/20/10 to weakness/mixed/stretch when weakness data exists. */
export function allocateAdaptivePuzzleMix(
  totalPuzzles: number,
  weakThemes: readonly string[],
): PuzzleMix {
  assertNonNegativeInteger(totalPuzzles, "totalPuzzles");
  const themes = uniqueIds(weakThemes, "weakThemes");
  const weights =
    themes.length > 0
      ? [
          { item: "weakness" as const, share: 0.7 },
          { item: "mixed" as const, share: 0.2 },
          { item: "stretch" as const, share: 0.1 },
        ]
      : [
          { item: "weakness" as const, share: 0 },
          { item: "mixed" as const, share: 0.9 },
          { item: "stretch" as const, share: 0.1 },
        ];
  const allocation = Object.fromEntries(
    allocateByLargestRemainder(totalPuzzles, weights).map(({ item, count }) => [
      item,
      count,
    ]),
  ) as Record<"weakness" | "mixed" | "stretch", number>;

  return {
    total: totalPuzzles,
    weakness: allocation.weakness,
    mixed: allocation.mixed,
    stretch: allocation.stretch,
    weakThemes: themes,
  };
}

export interface AdaptivePuzzlePlanInput extends AdaptivePuzzleBandInput {
  puzzleCount: number;
  themePerformance: readonly ThemePerformance[];
  weakThemeLimit?: number;
  minimumThemeAttempts?: number;
}

export interface AdaptivePuzzlePlan {
  band: AdaptivePuzzleBand;
  mix: PuzzleMix;
  weakThemes: RankedWeakTheme[];
}

export function buildAdaptivePuzzlePlan(
  input: AdaptivePuzzlePlanInput,
): AdaptivePuzzlePlan {
  const weakThemes = rankWeakThemes(input.themePerformance, {
    limit: input.weakThemeLimit,
    minimumAttempts: input.minimumThemeAttempts,
  });

  return {
    band: calculateAdaptivePuzzleBand(input),
    mix: allocateAdaptivePuzzleMix(
      input.puzzleCount,
      weakThemes.map(({ theme }) => theme),
    ),
    weakThemes,
  };
}

export interface TacticsProgressAttempt {
  correct: boolean;
  themes?: readonly string[];
}

export interface GameProgressSample {
  moves: number;
  blunders: number;
}

export type ProgressFocus =
  | "opening-foundation"
  | "tactical-weakness"
  | "play-and-review"
  | "balanced-maintenance";

export interface ProgressSummaryInput {
  openingMastery: OpeningMasterySummary;
  tacticsAttempts?: readonly TacticsProgressAttempt[];
  enrolledTacticsCards?: number;
  games?: readonly GameProgressSample[];
}

export interface ProgressSummary {
  phase: LearningPhase;
  focus: ProgressFocus;
  opening: {
    coveragePercent: number;
    retentionPercent: number;
    retainedPositions: number;
    totalPositions: number;
  };
  tactics: {
    attempts: number;
    correct: number;
    accuracyPercent: number | null;
    enrolledCards: number;
    weakThemes: string[];
  };
  games: {
    reviewed: number;
    moves: number;
    blunders: number;
    blundersPer100Moves: number | null;
  };
}

function percentage(rate: number): number {
  return Math.round(rate * 1_000) / 10;
}

/** Produces display-ready aggregate metrics without reading clocks or storage. */
export function summarizeProgress(
  input: ProgressSummaryInput,
): ProgressSummary {
  const tacticsAttempts = input.tacticsAttempts ?? [];
  const games = input.games ?? [];
  const enrolledTacticsCards = input.enrolledTacticsCards ?? 0;
  assertNonNegativeInteger(enrolledTacticsCards, "enrolledTacticsCards");

  const themeTotals = new Map<string, { attempts: number; correct: number }>();
  let tacticsCorrect = 0;
  for (const [index, attempt] of tacticsAttempts.entries()) {
    if (attempt.correct) tacticsCorrect += 1;
    const themes = uniqueIds(
      attempt.themes ?? [],
      `tacticsAttempts[${index}].themes`,
    );
    for (const theme of themes) {
      const total = themeTotals.get(theme) ?? { attempts: 0, correct: 0 };
      total.attempts += 1;
      if (attempt.correct) total.correct += 1;
      themeTotals.set(theme, total);
    }
  }

  let totalMoves = 0;
  let totalBlunders = 0;
  for (const [index, game] of games.entries()) {
    assertNonNegativeInteger(game.moves, `games[${index}].moves`);
    assertNonNegativeInteger(game.blunders, `games[${index}].blunders`);
    if (game.blunders > game.moves) {
      throw new RangeError("game blunders cannot exceed moves");
    }
    totalMoves += game.moves;
    totalBlunders += game.blunders;
  }

  const weakThemes = rankWeakThemes(
    [...themeTotals.entries()].map(([theme, total]) => ({ theme, ...total })),
  ).map(({ theme }) => theme);
  const phase = getLearningPhase(input.openingMastery);
  const tacticsAccuracy =
    tacticsAttempts.length === 0
      ? null
      : tacticsCorrect / tacticsAttempts.length;
  let focus: ProgressFocus;

  if (phase === "foundation") {
    focus = "opening-foundation";
  } else if (tacticsAccuracy === null || tacticsAccuracy < 0.75) {
    focus = "tactical-weakness";
  } else if (games.length === 0) {
    focus = "play-and-review";
  } else {
    focus = "balanced-maintenance";
  }

  return {
    phase,
    focus,
    opening: {
      coveragePercent: percentage(input.openingMastery.coverageRate),
      retentionPercent: percentage(input.openingMastery.retentionRate),
      retainedPositions: input.openingMastery.retainedCorePositions,
      totalPositions: input.openingMastery.totalCorePositions,
    },
    tactics: {
      attempts: tacticsAttempts.length,
      correct: tacticsCorrect,
      accuracyPercent:
        tacticsAccuracy === null ? null : percentage(tacticsAccuracy),
      enrolledCards: enrolledTacticsCards,
      weakThemes,
    },
    games: {
      reviewed: games.length,
      moves: totalMoves,
      blunders: totalBlunders,
      blundersPer100Moves:
        totalMoves === 0
          ? null
          : Math.round((totalBlunders / totalMoves) * 1000) / 10,
    },
  };
}
