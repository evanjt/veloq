/**
 * Strength training delegates.
 *
 * Wraps weight-training FFI: exercise sets, muscle groups, volume summaries,
 * and FIT file parsing. Return types are `any[]` / `any` because the strength
 * bindings are still pending regeneration after Rust changes.
 */

import type { DelegateHost } from './host';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getExerciseSets(host: DelegateHost, activityId: string): any[] {
  return host.timed('getExerciseSets', () => host.engine.strength().getExerciseSets(activityId));
}

export function isFitProcessed(host: DelegateHost, activityId: string): boolean {
  return host.timed('isFitProcessed', () => host.engine.strength().isFitProcessed(activityId));
}

export function fetchAndParseExerciseSets(
  host: DelegateHost,
  authHeader: string,
  activityId: string
): any[] {
  return host.timed('fetchAndParseExerciseSets', () =>
    host.engine.strength().fetchAndParseExerciseSets(authHeader, activityId)
  );
}

export function getMuscleGroups(host: DelegateHost, activityId: string): any[] {
  return host.timed('getMuscleGroups', () => host.engine.strength().getMuscleGroups(activityId));
}

export function getUnprocessedStrengthIds(host: DelegateHost, activityIds: string[]): string[] {
  return host.timed('getUnprocessedStrengthIds', () =>
    host.engine.strength().getUnprocessedStrengthIds(activityIds)
  );
}

export function batchFetchExerciseSets(
  host: DelegateHost,
  authHeader: string,
  activityIds: string[]
): string[] {
  return host.timed('batchFetchExerciseSets', () =>
    host.engine.strength().batchFetchExerciseSets(authHeader, activityIds)
  );
}

export function getStrengthSummary(host: DelegateHost, startTs: number, endTs: number): any {
  return host.timed('getStrengthSummary', () =>
    host.engine.strength().getStrengthSummary(BigInt(startTs), BigInt(endTs))
  );
}

export interface StrengthInsightSeries {
  monthly: any;
  weekly: any[];
}

/**
 * Batch strength aggregation: one monthly window plus N weekly windows in a
 * single FFI round-trip. Replaces the per-range getStrengthSummary loop in
 * the insights hook.
 */
export function getStrengthInsightSeries(
  host: DelegateHost,
  monthly: { startTs: number; endTs: number },
  weekly: Array<{ startTs: number; endTs: number }>
): StrengthInsightSeries {
  return host.timed('getStrengthInsightSeries', () =>
    host.engine.strength().getStrengthInsightSeries(
      { startTs: BigInt(monthly.startTs), endTs: BigInt(monthly.endTs) },
      weekly.map((r) => ({ startTs: BigInt(r.startTs), endTs: BigInt(r.endTs) }))
    )
  );
}

/**
 * Batch variant of getStrengthSummary: each range is aggregated under a
 * single engine lock, eliminating per-range FFI overhead for series callers
 * (e.g. muscle progression charts).
 */
export function getStrengthSummaryBatch(
  host: DelegateHost,
  ranges: Array<{ startTs: number; endTs: number }>
): any[] {
  if (ranges.length === 0) return [];
  return host.timed('getStrengthSummaryBatch', () =>
    host.engine.strength().getStrengthSummaryBatch(
      ranges.map((r) => ({ startTs: BigInt(r.startTs), endTs: BigInt(r.endTs) }))
    )
  );
}

export interface MuscleGroupDetailFfi {
  slug: string;
  exercises: Array<{
    name: string;
    role: string;
    sets: number;
    reps: number;
    volumeKg: number;
  }>;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  primaryExercises: number;
  secondaryExercises: number;
}

/**
 * Per-activity muscle breakdown aggregated in Rust: exercises sorted (primary
 * first, then by volume descending), with totals. Consumed by
 * `useMuscleDetail`, which becomes a thin pass-through.
 */
export function getMuscleDetail(
  host: DelegateHost,
  activityId: string,
  muscleSlug: string
): MuscleGroupDetailFfi | null {
  if (!host.ready || !activityId || !muscleSlug) return null;
  return host.timed('getMuscleDetail', () =>
    host.engine.strength().getMuscleDetail(activityId, muscleSlug)
  );
}

export function hasStrengthData(host: DelegateHost): boolean {
  return host.timed('hasStrengthData', () => host.engine.strength().hasStrengthData());
}

export function getExercisesForMuscle(
  host: DelegateHost,
  startTs: number,
  endTs: number,
  muscleSlug: string
): any {
  return host.timed('getExercisesForMuscle', () =>
    host.engine.strength().getExercisesForMuscle(BigInt(startTs), BigInt(endTs), muscleSlug)
  );
}

export function getActivitiesForExercise(
  host: DelegateHost,
  startTs: number,
  endTs: number,
  muscleSlug: string,
  exerciseCategory: number
): any {
  return host.timed('getActivitiesForExercise', () =>
    host.engine
      .strength()
      .getActivitiesForExercise(BigInt(startTs), BigInt(endTs), muscleSlug, exerciseCategory)
  );
}
