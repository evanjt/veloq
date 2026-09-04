/**
 * Strength training delegates.
 *
 * Wraps weight-training FFI: exercise sets, muscle groups, volume summaries,
 * and FIT file parsing.
 */

import type { DelegateHost } from './host';
import type {
  FfiExerciseActivities,
  FfiExerciseSet,
  FfiMuscleExerciseSummary,
  FfiMuscleGroup,
  FfiMuscleGroupDetail,
  FfiStrengthInsightSeries,
  FfiStrengthSummary,
} from '../generated/veloqrs';

export function getExerciseSets(host: DelegateHost, activityId: string): FfiExerciseSet[] {
  return host.timed('getExerciseSets', () => host.engine.strength().getExerciseSets(activityId));
}

export function isFitProcessed(host: DelegateHost, activityId: string): boolean {
  return host.timed('isFitProcessed', () => host.engine.strength().isFitProcessed(activityId));
}

export function fetchAndParseExerciseSets(host: DelegateHost, activityId: string): boolean {
  return host.timed('fetchAndParseExerciseSets', () =>
    host.engine.strength().fetchAndParseExerciseSets(activityId)
  );
}

export function getMuscleGroups(host: DelegateHost, activityId: string): FfiMuscleGroup[] {
  return host.timed('getMuscleGroups', () => host.engine.strength().getMuscleGroups(activityId));
}

export function getUnprocessedStrengthIds(host: DelegateHost, activityIds: string[]): string[] {
  return host.timed('getUnprocessedStrengthIds', () =>
    host.engine.strength().getUnprocessedStrengthIds(activityIds)
  );
}

export function batchFetchExerciseSets(host: DelegateHost, activityIds: string[]): boolean {
  return host.timed('batchFetchExerciseSets', () =>
    host.engine.strength().batchFetchExerciseSets(activityIds)
  );
}

/**
 * Parse raw FIT bytes locally (no network) and store any strength sets for
 * the activity. Returns the number of sets inserted. Use this when the FIT
 * buffer is already in hand - e.g. right after recording or when replaying a
 * local backup - so Strength data is available without waiting for
 * intervals.icu to process and re-emit the file.
 */
export function importSetsFromFit(
  host: DelegateHost,
  activityId: string,
  fitBytes: Uint8Array
): number {
  // The binding takes an ArrayBuffer; a Uint8Array view over a larger or
  // offset buffer would hand the native side the wrong bytes.
  const buffer = fitBytes.buffer.slice(
    fitBytes.byteOffset,
    fitBytes.byteOffset + fitBytes.byteLength
  ) as ArrayBuffer;
  return host.timed('importSetsFromFit', () =>
    host.engine.strength().importSetsFromFit(activityId, buffer)
  );
}

export function getStrengthSummary(
  host: DelegateHost,
  startTs: number,
  endTs: number
): FfiStrengthSummary {
  return host.timed('getStrengthSummary', () =>
    host.engine.strength().getStrengthSummary(BigInt(startTs), BigInt(endTs))
  );
}

export type StrengthInsightSeries = FfiStrengthInsightSeries;

/**
 * Batch variant of getStrengthSummary: each range is aggregated under a
 * single engine lock, eliminating per-range FFI overhead for series callers
 * (e.g. muscle progression charts).
 */
export function getStrengthSummaryBatch(
  host: DelegateHost,
  ranges: { startTs: number; endTs: number }[]
): FfiStrengthSummary[] {
  if (ranges.length === 0) return [];
  return host.timed('getStrengthSummaryBatch', () =>
    host.engine
      .strength()
      .getStrengthSummaryBatch(
        ranges.map((r) => ({ startTs: BigInt(r.startTs), endTs: BigInt(r.endTs) }))
      )
  );
}

export type MuscleGroupDetailFfi = FfiMuscleGroupDetail;

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
): FfiMuscleExerciseSummary {
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
): FfiExerciseActivities {
  return host.timed('getActivitiesForExercise', () =>
    host.engine
      .strength()
      .getActivitiesForExercise(BigInt(startTs), BigInt(endTs), muscleSlug, exerciseCategory)
  );
}
