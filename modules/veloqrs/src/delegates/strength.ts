/**
 * Strength training delegates.
 *
 * Wraps weight-training FFI: exercise sets, muscle groups, volume summaries,
 * and FIT file parsing.
 */

import { FfiStartOutcome } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import type {
  FfiExerciseActivities,
  FfiExerciseSet,
  FfiMuscleGroup,
  FfiMuscleGroupDetail,
  FfiStrengthInsightSeries,
  FfiStrengthScreenData,
} from '../generated/veloqrs';

export function getExerciseSets(host: DelegateHost, activityId: string): FfiExerciseSet[] {
  return host.timed('getExerciseSets', () => host.engine.strength().getExerciseSets(activityId));
}

export function isFitProcessed(host: DelegateHost, activityId: string): boolean {
  return host.timed('isFitProcessed', () => host.engine.strength().isFitProcessed(activityId));
}

export function fetchAndParseExerciseSets(
  host: DelegateHost,
  activityId: string
): FfiStartOutcome {
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

export function batchFetchExerciseSets(
  host: DelegateHost,
  activityIds: string[]
): FfiStartOutcome {
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

export type StrengthInsightSeries = FfiStrengthInsightSeries;
export type StrengthScreenData = FfiStrengthScreenData;

/**
 * Everything the strength tab draws: the chosen period by muscle, the exercises
 * behind each one, and the trailing weeks with the ranking across them. One
 * read, because all four are aggregates of the same sets.
 */
export function getStrengthScreenData(
  host: DelegateHost,
  startTs: number,
  endTs: number,
  weekRanges: { startTs: number; endTs: number }[]
): FfiStrengthScreenData {
  return host.timed('getStrengthScreenData', () =>
    host.engine
      .strength()
      .getScreenData(
        BigInt(startTs),
        BigInt(endTs),
        weekRanges.map((r) => ({ startTs: r.startTs, endTs: r.endTs }))
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
