/** Aggregated muscle group volume over a time period. */
export interface MuscleVolume {
  slug: string;
  primarySets: number;
  secondarySets: number;
  /** Weighted set count: primary=1.0, secondary=0.5 */
  weightedSets: number;
  totalReps: number;
  volumeKg: number;
  exerciseNames: string[];
}

/** Summary of strength training volume over a time period. */
export interface StrengthSummary {
  muscleVolumes: MuscleVolume[];
  activityCount: number;
  totalSets: number;
  /** The engine's verdict per opposing pair, one entry per pair, trained or not. */
  balance: EngineBalancePair[];
}

/** One pair as the engine reports it: numbers and a verdict, no copy. */
export interface EngineBalancePair {
  id: string;
  leftSlug: string;
  rightSlug: string;
  leftWeightedSets: number;
  rightWeightedSets: number;
  dominantSlug: string | null;
  ratio: number | null;
  status: StrengthBalanceStatus;
}

export type { StrengthPeriod } from './periods';

export interface StrengthProgressPoint {
  label: string;
  startTs: number;
  endTs: number;
  weightedSets: number;
  activityCount: number;
}

export type StrengthProgressTrend = 'up' | 'down' | 'flat';

export interface StrengthProgression {
  muscleSlug: string;
  points: StrengthProgressPoint[];
  recentAverage: number;
  baselineAverage: number;
  peakWeightedSets: number;
  changePct: number | null;
  trend: StrengthProgressTrend;
}

/**
 * The engine's ranking of one muscle over the trailing weeks, weekly figures
 * in place of the labelled points the screen builds for its chart.
 */
export interface StrengthProgressionRecord {
  muscleSlug: string;
  weeklyWeightedSets: number[];
  recentAverage: number;
  baselineAverage: number;
  peakWeightedSets: number;
  changePct: number | null;
  trend: StrengthProgressTrend;
  /** The engine's distance of the recent average from the baseline, in weekly deviations. */
  signalDelta: number | null;
}

export type StrengthBalanceStatus =
  | 'balanced'
  | 'watch'
  | 'imbalanced'
  | 'one-sided'
  | 'insufficient';

export interface StrengthBalancePair {
  id: string;
  label: string;
  leftSlug: string;
  rightSlug: string;
  leftLabel: string;
  rightLabel: string;
  leftWeightedSets: number;
  rightWeightedSets: number;
  dominantSlug: string | null;
  dominantLabel: string | null;
  ratio: number | null;
  status: StrengthBalanceStatus;
}

/** Summary of a single exercise targeting a muscle group. */
export interface ExerciseSummary {
  exerciseName: string;
  exerciseCategory: number;
  totalSets: number;
  totalReps: number;
  volumeKg: number;
  activityCount: number;
  isPrimary: boolean;
}

/** Exercise summaries for a specific muscle group over a period. */
export interface MuscleExerciseSummary {
  exercises: ExerciseSummary[];
}

/** One muscle's exercises over the period, as the screen read carries them. */
export interface MuscleExercises {
  muscleSlug: string;
  exercises: ExerciseSummary[];
}

/**
 * Everything the strength tab draws, from one engine read. The weeks are the
 * reader's own: the engine ranks them, and the labels are translated here.
 */
export interface StrengthScreenData {
  summary: StrengthSummary;
  weeks: { label: string; startTs: number; endTs: number }[];
  weekly: StrengthSummary[];
  progressions: StrengthProgressionRecord[];
  exercises: MuscleExercises[];
  /** Strength activities in the period still owed their FIT file. */
  owedCount: number;
}
