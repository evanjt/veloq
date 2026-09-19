import type {
  EngineBalancePair,
  MuscleExerciseSummary,
  StrengthBalancePair,
  StrengthBalanceStatus,
  StrengthProgression,
  StrengthProgressionRecord,
  StrengthProgressTrend,
  StrengthScreenData,
} from '../types';

import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from './exerciseMuscleMap';

/** The engine's slugs are the same set, but they cross the FFI as strings. */
function muscleName(slug: string): string {
  return MUSCLE_DISPLAY_NAMES[slug as MuscleSlug] ?? slug;
}

/**
 * What each pair is called. The pairs themselves, the volumes on each side and
 * the verdict come from the engine (`objects/strength.rs`, `balance_pairs`),
 * which is where the arithmetic they are a function of already lived.
 */
const BALANCE_PAIR_LABELS: Record<string, string> = {
  quads_hamstrings: 'Quads vs Hamstrings',
  chest_back: 'Chest vs Upper Back',
  biceps_triceps: 'Biceps vs Triceps',
};

/** Every pair and what it is called, for the screen that lists them. */
export const BALANCE_PAIR_NAMES = Object.entries(BALANCE_PAIR_LABELS).map(([id, label]) => ({
  id,
  label,
}));

const BALANCE_SEVERITY: Record<StrengthBalanceStatus, number> = {
  'one-sided': 4,
  imbalanced: 3,
  watch: 2,
  balanced: 1,
  insufficient: 0,
};

export function buildStrengthBalancePairs(pairs: EngineBalancePair[]): StrengthBalancePair[] {
  const named = pairs.map((pair) => ({
    ...pair,
    label: BALANCE_PAIR_LABELS[pair.id] ?? pair.id,
    leftLabel: muscleName(pair.leftSlug),
    rightLabel: muscleName(pair.rightSlug),
    dominantLabel: pair.dominantSlug ? muscleName(pair.dominantSlug) : null,
  }));

  return named.sort((a, b) => {
    const severityDiff = BALANCE_SEVERITY[b.status] - BALANCE_SEVERITY[a.status];
    if (severityDiff !== 0) return severityDiff;
    return (b.ratio ?? 0) - (a.ratio ?? 0);
  });
}

/**
 * The engine's progression record as it crosses the FFI, with `changePct`
 * absent rather than null and `trend` still a bare string.
 */
export function normalizeStrengthProgression(raw: {
  muscleSlug: string;
  weeklyWeightedSets: number[];
  recentAverage: number;
  baselineAverage: number;
  peakWeightedSets: number;
  changePct?: number;
  trend: string;
}): StrengthProgressionRecord {
  return {
    muscleSlug: raw.muscleSlug,
    weeklyWeightedSets: raw.weeklyWeightedSets,
    recentAverage: raw.recentAverage,
    baselineAverage: raw.baselineAverage,
    peakWeightedSets: raw.peakWeightedSets,
    changePct: raw.changePct ?? null,
    trend: raw.trend as StrengthProgressTrend,
  };
}

/**
 * One muscle's four-week chart out of the screen read.
 *
 * The engine ranked the weeks; what it has no business holding is the label on
 * each bar, which is translated and already in the reader's hand.
 */
export function selectProgression(
  data: StrengthScreenData | undefined | null,
  muscleSlug: string | null
): StrengthProgression | null {
  if (!data || !muscleSlug) return null;
  const ranked = data.progressions.find((p) => p.muscleSlug === muscleSlug);
  if (!ranked) return null;

  const points = data.weeks.map((week, index) => ({
    label: week.label,
    startTs: week.startTs,
    endTs: week.endTs,
    weightedSets: ranked.weeklyWeightedSets[index] ?? 0,
    activityCount: data.weekly[index]?.activityCount ?? 0,
  }));

  return { ...ranked, points };
}

/**
 * One muscle's exercise list out of the same read. A muscle the period never
 * reached is an empty list rather than nothing, so the list keeps its place
 * while a finger crosses an untrained muscle.
 */
export function selectExercises(
  data: StrengthScreenData | undefined | null,
  muscleSlug: string | null
): MuscleExerciseSummary {
  const periodDays = data?.periodDays ?? 0;
  if (!data || !muscleSlug) return { exercises: [], periodDays };
  const muscle = data.exercises.find((m) => m.muscleSlug === muscleSlug);
  return { exercises: muscle?.exercises ?? [], periodDays };
}
