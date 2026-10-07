import type {
  EngineBalancePair,
  MuscleExerciseSummary,
  StrengthBalancePair,
  StrengthBalanceStatus,
  StrengthProgression,
  StrengthProgressionRecord,
  StrengthProgressTrend,
  StrengthScreenData,
  StrengthSummary,
} from '../types';

import {
  BALANCE_PAIR_NAME_KEYS,
  balancePairName,
  muscleName,
  type NameTranslator,
} from './muscleNames';

/**
 * Every pair the screen lists and what it is called. The pairs themselves, the
 * volumes on each side and the verdict come from the engine
 * (`objects/strength.rs`, `balance_pairs`), which is where the arithmetic they
 * are a function of already lived.
 */
export function listBalancePairNames(t: NameTranslator): { id: string; label: string }[] {
  return Object.keys(BALANCE_PAIR_NAME_KEYS).map((id) => ({ id, label: balancePairName(id, t) }));
}

const BALANCE_SEVERITY: Record<StrengthBalanceStatus, number> = {
  'one-sided': 4,
  imbalanced: 3,
  watch: 2,
  balanced: 1,
  insufficient: 0,
};

export function buildStrengthBalancePairs(
  pairs: EngineBalancePair[],
  t: NameTranslator
): StrengthBalancePair[] {
  const named = pairs.map((pair) => ({
    ...pair,
    label: balancePairName(pair.id, t),
    leftLabel: muscleName(pair.leftSlug, t),
    rightLabel: muscleName(pair.rightSlug, t),
    dominantLabel: pair.dominantSlug ? muscleName(pair.dominantSlug, t) : null,
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
  signalDelta?: number;
}): StrengthProgressionRecord {
  return {
    muscleSlug: raw.muscleSlug,
    weeklyWeightedSets: raw.weeklyWeightedSets,
    recentAverage: raw.recentAverage,
    baselineAverage: raw.baselineAverage,
    peakWeightedSets: raw.peakWeightedSets,
    changePct: raw.changePct ?? null,
    trend: raw.trend as StrengthProgressTrend,
    signalDelta: raw.signalDelta ?? null,
  };
}

/**
 * The engine's strength summary as it crosses the FFI, with optional fields
 * filled and the verdict typed. The strength tab and the insights both read
 * one, so both map it here.
 */
export function normalizeStrengthSummary(raw: {
  muscleVolumes?: {
    slug: string;
    primarySets: number;
    secondarySets: number;
    weightedSets: number;
    totalReps: number;
    volumeKg: number;
    exerciseNames: string[];
  }[];
  activityCount?: number;
  totalSets?: number;
  balance?: {
    id: string;
    leftSlug: string;
    rightSlug: string;
    leftWeightedSets: number;
    rightWeightedSets: number;
    dominantSlug?: string | null;
    ratio?: number | null;
    status: string;
  }[];
}): StrengthSummary {
  return {
    muscleVolumes: (raw.muscleVolumes ?? []).map((v) => ({
      slug: v.slug,
      primarySets: v.primarySets,
      secondarySets: v.secondarySets,
      weightedSets: v.weightedSets,
      totalReps: v.totalReps,
      volumeKg: v.volumeKg,
      exerciseNames: v.exerciseNames,
    })),
    activityCount: raw.activityCount ?? 0,
    totalSets: raw.totalSets ?? 0,
    balance: (raw.balance ?? []).map((pair) => ({
      id: pair.id,
      leftSlug: pair.leftSlug,
      rightSlug: pair.rightSlug,
      leftWeightedSets: pair.leftWeightedSets,
      rightWeightedSets: pair.rightWeightedSets,
      dominantSlug: pair.dominantSlug ?? null,
      ratio: pair.ratio ?? null,
      status: pair.status as StrengthBalanceStatus,
    })),
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
  if (!data || !muscleSlug) return { exercises: [] };
  const muscle = data.exercises.find((m) => m.muscleSlug === muscleSlug);
  return { exercises: muscle?.exercises ?? [] };
}
