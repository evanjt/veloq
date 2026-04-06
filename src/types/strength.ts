/** Aggregated muscle group volume over a time period. */
export interface MuscleVolume {
  slug: string;
  primarySets: number;
  secondarySets: number;
  /** Weighted set count: primary=1.0, secondary=0.5 */
  weightedSets: number;
  totalReps: number;
  totalWeightKg: number;
  exerciseNames: string[];
}

/** Summary of strength training volume over a time period. */
export interface StrengthSummary {
  muscleVolumes: MuscleVolume[];
  activityCount: number;
  totalSets: number;
}

export type StrengthPeriod = 'week' | '4weeks' | '3months' | '6months';

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
  frequencyDays: number;
  totalSets: number;
  totalWeightKg: number;
  activityCount: number;
  isPrimary: boolean;
}

/** Exercise summaries for a specific muscle group over a period. */
export interface MuscleExerciseSummary {
  exercises: ExerciseSummary[];
  periodDays: number;
}

/** A single activity containing a specific exercise. */
export interface ExerciseActivity {
  activityId: string;
  activityName: string;
  date: number;
  sets: number;
  totalWeightKg: number;
  isPrimary: boolean;
}
