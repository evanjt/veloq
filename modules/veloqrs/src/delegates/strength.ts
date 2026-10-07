/**
 * Strength training delegates.
 *
 * Wraps weight-training FFI: exercise sets, muscle groups, volume summaries,
 * and FIT file parsing.
 */

import { FfiStartOutcome } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { startResult } from './start';
import type {
  FfiExerciseActivities,
  FfiStartResult,
  FfiExerciseDetailData,
  FfiExerciseSession,
  FfiExerciseSet,
  FfiMuscleGroup,
  FfiMuscleGroupDetail,
  FfiStrengthInsightSeries,
  FfiStrengthScreenData,
  FfiStrengthSummary,
} from '../generated/veloqrs';

const EMPTY_SESSION: FfiExerciseSession = {
  sets: [],
  groups: [],
  activeSetCount: 0,
  exerciseCount: 0,
  totalVolumeKg: 0,
  totalDurationSecs: 0,
};

export function getExerciseSets(host: DelegateHost, activityId: string): FfiExerciseSession {
  if (!host.ready) return EMPTY_SESSION;
  return host.timed('getExerciseSets', () => host.engine.strength().getExerciseSets(activityId));
}

export function getExerciseDetailData(
  host: DelegateHost,
  exerciseCategory: number
): FfiExerciseDetailData | null {
  if (!host.ready) return null;
  return host.timed('getExerciseDetailData', () =>
    host.engine.strength().getExerciseDetailData(exerciseCategory)
  );
}

export function isFitProcessed(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  return host.timed('isFitProcessed', () => host.engine.strength().isFitProcessed(activityId));
}

export function fetchAndParseExerciseSets(host: DelegateHost, activityId: string): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('fetchAndParseExerciseSets', () =>
    host.engine.strength().fetchAndParseExerciseSets(activityId)
  );
}

export function getMuscleGroups(host: DelegateHost, activityId: string): FfiMuscleGroup[] {
  if (!host.ready) return [];
  return host.timed('getMuscleGroups', () => host.engine.strength().getMuscleGroups(activityId));
}

export function getUnprocessedStrengthIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getUnprocessedStrengthIds', () =>
    host.engine.strength().getUnprocessedStrengthIds()
  );
}

export function batchFetchExerciseSets(host: DelegateHost, activityIds: string[]): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('batchFetchExerciseSets', () =>
    host.engine.strength().batchFetchExerciseSets(activityIds)
  );
}

const EMPTY_SUMMARY: FfiStrengthSummary = {
  muscleVolumes: [],
  activityCount: 0,
  totalSets: 0,
  balance: [],
};

const EMPTY_SCREEN_DATA: FfiStrengthScreenData = {
  summary: EMPTY_SUMMARY,
  weekly: [],
  progressions: [],
  exercises: [],
  owedCount: 0,
};

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
  if (!host.ready) return EMPTY_SCREEN_DATA;
  return host.timed('getStrengthScreenData', () =>
    host.engine.strength().getScreenData(
      startTs,
      endTs,
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
  if (!host.ready) return false;
  return host.timed('hasStrengthData', () => host.engine.strength().hasStrengthData());
}

export function getActivitiesForExercise(
  host: DelegateHost,
  startTs: number,
  endTs: number,
  muscleSlug: string,
  exerciseCategory: number
): FfiExerciseActivities {
  if (!host.ready) return { activities: [] };
  return host.timed('getActivitiesForExercise', () =>
    host.engine.strength().getActivitiesForExercise(startTs, endTs, muscleSlug, exerciseCategory)
  );
}

/** Insert pre-parsed sets without the network. Held in order until the engine opens. */
export function bulkInsertExerciseSets(
  host: DelegateHost,
  activityId: string,
  sets: FfiExerciseSet[]
): void {
  host.write('bulkInsertExerciseSets', () =>
    host.engine.strength().bulkInsertExerciseSets(activityId, sets)
  );
}
