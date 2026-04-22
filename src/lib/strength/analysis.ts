import { MUSCLE_DISPLAY_NAMES } from './exerciseMuscleMap';
import type {
  MuscleVolume,
  StrengthBalancePair,
  StrengthBalanceStatus,
  StrengthProgressPoint,
  StrengthProgression,
} from '@/types';

const WATCH_RATIO = 1.35;
const IMBALANCED_RATIO = 2;
const MIN_BALANCE_SIGNAL = 4;

export const BALANCE_PAIRS = [
  {
    id: 'quads_hamstrings',
    label: 'Quads vs Hamstrings',
    leftSlug: 'quadriceps',
    rightSlug: 'hamstring',
  },
  {
    id: 'chest_back',
    label: 'Chest vs Upper Back',
    leftSlug: 'chest',
    rightSlug: 'upper-back',
  },
  {
    id: 'biceps_triceps',
    label: 'Biceps vs Triceps',
    leftSlug: 'biceps',
    rightSlug: 'triceps',
  },
] as const;

const BALANCE_SEVERITY: Record<StrengthBalanceStatus, number> = {
  'one-sided': 4,
  imbalanced: 3,
  watch: 2,
  balanced: 1,
  insufficient: 0,
};

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildStrengthProgression(
  muscleSlug: string,
  points: StrengthProgressPoint[]
): StrengthProgression {
  const normalizedPoints = points.map((point) => ({
    ...point,
    weightedSets: roundToOne(point.weightedSets),
  }));
  const firstHalf = normalizedPoints.slice(0, 2);
  const secondHalf = normalizedPoints.slice(-2);
  const baselineAverage =
    firstHalf.reduce((sum, point) => sum + point.weightedSets, 0) / Math.max(firstHalf.length, 1);
  const recentAverage =
    secondHalf.reduce((sum, point) => sum + point.weightedSets, 0) / Math.max(secondHalf.length, 1);

  let changePct: number | null = null;
  let trend: StrengthProgression['trend'] = 'flat';

  if (baselineAverage > 0) {
    changePct = ((recentAverage - baselineAverage) / baselineAverage) * 100;
    if (changePct >= 15) trend = 'up';
    else if (changePct <= -15) trend = 'down';
  } else if (recentAverage > 0) {
    trend = 'up';
  }

  return {
    muscleSlug,
    points: normalizedPoints,
    recentAverage: roundToOne(recentAverage),
    baselineAverage: roundToOne(baselineAverage),
    peakWeightedSets: roundToOne(
      normalizedPoints.reduce((peak, point) => Math.max(peak, point.weightedSets), 0)
    ),
    changePct: changePct == null ? null : roundToOne(changePct),
    trend,
  };
}

export function buildStrengthBalancePairs(muscleVolumes: MuscleVolume[]): StrengthBalancePair[] {
  const volumeMap = new Map(muscleVolumes.map((muscle) => [muscle.slug, muscle.weightedSets]));

  const pairs = BALANCE_PAIRS.map((pair) => {
    const leftWeightedSets = roundToOne(volumeMap.get(pair.leftSlug) ?? 0);
    const rightWeightedSets = roundToOne(volumeMap.get(pair.rightSlug) ?? 0);
    const total = leftWeightedSets + rightWeightedSets;
    const maxSide = Math.max(leftWeightedSets, rightWeightedSets);
    const minSide = Math.min(leftWeightedSets, rightWeightedSets);
    const ratio = maxSide === 0 ? null : minSide === 0 ? Infinity : maxSide / minSide;
    const dominantSlug =
      leftWeightedSets === rightWeightedSets
        ? null
        : leftWeightedSets > rightWeightedSets
          ? pair.leftSlug
          : pair.rightSlug;
    const dominantLabel = dominantSlug ? MUSCLE_DISPLAY_NAMES[dominantSlug] : null;

    let status: StrengthBalanceStatus = 'balanced';
    if (total < MIN_BALANCE_SIGNAL) {
      status = 'insufficient';
    } else if (minSide === 0) {
      status = 'one-sided';
    } else if (ratio != null && ratio >= IMBALANCED_RATIO) {
      status = 'imbalanced';
    } else if (ratio != null && ratio >= WATCH_RATIO) {
      status = 'watch';
    }

    return {
      id: pair.id,
      label: pair.label,
      leftSlug: pair.leftSlug,
      rightSlug: pair.rightSlug,
      leftLabel: MUSCLE_DISPLAY_NAMES[pair.leftSlug],
      rightLabel: MUSCLE_DISPLAY_NAMES[pair.rightSlug],
      leftWeightedSets,
      rightWeightedSets,
      dominantSlug,
      dominantLabel,
      ratio,
      status,
    };
  });

  return pairs.sort((a, b) => {
    const severityDiff = BALANCE_SEVERITY[b.status] - BALANCE_SEVERITY[a.status];
    if (severityDiff !== 0) return severityDiff;
    return (b.ratio ?? 0) - (a.ratio ?? 0);
  });
}
