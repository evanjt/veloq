/**
 * Strength training delegates.
 *
 * Wraps weight-training FFI: exercise sets, muscle groups, volume summaries,
 * and FIT file parsing.
 */

import { FfiLiveEditKind, FfiStartOutcome, FfiStrengthStartKind } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { startResult } from './start';
import type {
  FfiStartResult,
  FfiExerciseDetailData,
  FfiExercisePickerData,
  FfiExerciseSession,
  FfiFocusState,
  FfiLiveEdit,
  FfiLiveStrengthOutcome,
  FfiLiveStrengthSession,
  FfiMuscleGroup,
  FfiMuscleGroupDetail,
  FfiStrengthInsightSeries,
  FfiStrengthScreenData,
  FfiStrengthStartData,
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

/** Hand the engine the athlete's exercise labels, a catalogue label key to its text. */
export function setExerciseLabels(host: DelegateHost, labels: Map<string, string>): void {
  host.write('setExerciseLabels', () => host.engine.strength().setExerciseLabels(labels));
}

/** Catalogue label keys best match first for a typed query, over the labels last handed in. */
export function searchExercises(
  host: DelegateHost,
  query: string,
  relevance: Map<string, number>
): string[] {
  if (!host.ready) return [];
  return host.timed('searchExercises', () =>
    host.engine.strength().searchExercises(query, relevance)
  );
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

const EMPTY_PICKER: FfiExercisePickerData = { rows: [], equipment: [], muscles: [] };

/** The exercise picker's list narrowed by the filters, ordered by what the athlete does. */
export function getExercisePickerData(
  host: DelegateHost,
  equipment: string[],
  region: string | undefined,
  muscle: string | undefined,
  query: string,
  afterCategory: number | undefined,
  afterName: number | undefined,
  now: number
): FfiExercisePickerData {
  if (!host.ready) return EMPTY_PICKER;
  return host.timed('getExercisePickerData', () =>
    host.engine
      .strength()
      .getExercisePickerData(equipment, region, muscle, query, afterCategory, afterName, now)
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

export function batchFetchOwedFitFiles(host: DelegateHost): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('batchFetchOwedFitFiles', () =>
    host.engine.strength().batchFetchOwedFitFiles()
  );
}

const EMPTY_SUMMARY: FfiStrengthSummary = {
  startTs: 0,
  muscleVolumes: [],
  activityCount: 0,
  totalSets: 0,
  balance: [],
  maxWeightedSets: 0,
  shadeCeilings: [0, 0, 0, 0, 0],
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

const EMPTY_START_DATA: FfiStrengthStartData = {
  live: false,
  groups: [],
  workouts: [],
  removed: [],
};

/**
 * What the strength start screen shows: whether a session is live, the sessions the
 * athlete has done the same way before and the saved workouts. `now` is epoch seconds.
 */
export function getStrengthStartData(host: DelegateHost, now: number): FfiStrengthStartData {
  if (!host.ready) return EMPTY_START_DATA;
  return host.timed('getStrengthStartData', () => host.engine.strength().getStrengthStartData(now));
}

/**
 * Put a removed workout back in the saved list. Does nothing while the engine is closed; the
 * engine refuses an id that is not a removed workout, and the refusal throws.
 */
export function recoverStrengthWorkout(host: DelegateHost, id: string): void {
  if (!host.ready) return;
  host.timed('recoverStrengthWorkout', () => host.engine.strength().recoverStrengthWorkout(id));
}

/** The strength session being recorded, or null when none is or the engine is closed. */
export function getLiveStrengthSession(host: DelegateHost): FfiLiveStrengthSession | null {
  if (!host.ready) return null;
  return (
    host.timed('getLiveStrengthSession', () => host.engine.strength().getLiveStrengthSession()) ??
    null
  );
}

/**
 * What the focus view and the lock screen show of the live session: the set to do with its
 * weight in the athlete's unit and the stored kilograms one stepper tap up or down lands on, the
 * neighbouring exercises and the rest. Null when no session is live or the engine is closed.
 */
export function getLiveFocusState(host: DelegateHost): FfiFocusState | null {
  if (!host.ready) return null;
  return host.timed('getLiveFocusState', () => host.engine.strength().getLiveFocusState()) ?? null;
}

/** Where a new live session takes its exercises from; the id names the source it needs. */
export type StrengthStart =
  { kind: 'Blank' } | { kind: 'Session' | 'Activity' | 'Workout'; id: string };

/**
 * Start the live session, prepared with nothing done. Null while the engine is closed.
 * The engine refuses a start while a session is live, and the refusal throws.
 */
export function startLiveStrengthSession(
  host: DelegateHost,
  from: StrengthStart,
  now: number
): FfiLiveStrengthSession | null {
  if (!host.ready) return null;
  return host.timed('startLiveStrengthSession', () =>
    host.engine
      .strength()
      .startLiveStrengthSession(
        FfiStrengthStartKind[from.kind],
        from.kind === 'Blank' ? undefined : from.id,
        now
      )
  );
}

/**
 * Start the live session from the lines of a planned workout: the engine reads each line into
 * an exercise with its sets, a rest or a session note. Null while the engine is closed; the
 * engine refuses a start while a session is live, and the refusal throws.
 */
export function startLiveStrengthSessionFromPlan(
  host: DelegateHost,
  lines: string[],
  now: number
): FfiLiveStrengthSession | null {
  if (!host.ready) return null;
  return host.timed('startLiveStrengthSessionFromPlan', () =>
    host.engine.strength().startLiveStrengthSessionFromPlan(lines, now)
  );
}

/** One change to the live session: its kind and the fields that kind reads. */
export type LiveStrengthEdit = Omit<FfiLiveEdit, 'kind'> & {
  kind: keyof typeof FfiLiveEditKind;
};

/**
 * Make one change to the live session and answer it as it now stands. Null while the engine
 * is closed; a change the engine refuses throws and leaves the session as it was.
 */
export function editLiveStrengthSession(
  host: DelegateHost,
  edit: LiveStrengthEdit,
  now: number
): FfiLiveStrengthOutcome | null {
  if (!host.ready) return null;
  return host.timed('editLiveStrengthSession', () =>
    host.engine
      .strength()
      .editLiveStrengthSession({ ...edit, kind: FfiLiveEditKind[edit.kind] }, now)
  );
}

/** Drop the live session and everything in it. Held in order until the engine opens. */
export function discardLiveStrengthSession(host: DelegateHost): void {
  host.write('discardLiveStrengthSession', () =>
    host.engine.strength().discardLiveStrengthSession()
  );
}
