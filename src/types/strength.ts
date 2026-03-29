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
