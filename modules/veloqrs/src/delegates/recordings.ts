/**
 * Recording index delegates.
 *
 * The index is a table, not a JSON blob under a lock: two writers racing is
 * what SQLite answers, and the retry policy lives beside the state it reads.
 * The FIT file and a manual entry's body stay the caller's to write and delete.
 */

import { FfiUploadOutcome, UploadRefusal, UploadTransition } from '../generated/veloqrs';
import type { FfiRecordingEntry, FfiUploadResult } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { present } from './optional';

/**
 * One recording, with its epoch milliseconds as numbers.
 *
 * The generated record carries these as numbers now, so nothing is converted
 * here: the fields cross as `f64`, which is exact to 2^53 and holds every
 * epoch millisecond, duration and id this record carries.
 */
export interface RecordingEntry {
  id: string;
  /** `fit` for a recorded ride, `manual` for an entry with no file behind it. */
  kind: string;
  fitPath: string;
  streamsPath?: string;
  activityType: string;
  name: string;
  startTime: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGain?: number;
  avgHeartrate?: number;
  pairedEventId?: number;
  createdAt: number;
  uploadStatus: string;
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
  intervalsActivityId?: string;
  engineActivityId?: string;
  /** Whether the engine row has taken the id intervals.icu gave the upload. */
  engineReconciled: boolean;
  /** The athlete this recording was saved under. */
  athleteId?: string;
  /** What the athlete wrote on the review screen. */
  notes?: string;
  /** The effort from 1 to 10, absent when the slider was never moved. */
  rpe?: number;
  /** Whether intervals.icu has the effort. */
  rpeSent: boolean;
}

function toEntry(row: FfiRecordingEntry): RecordingEntry {
  return present({
    id: row.id,
    kind: row.kind,
    fitPath: row.fitPath,
    streamsPath: row.streamsPath ?? undefined,
    activityType: row.activityType,
    name: row.name,
    startTime: Number(row.startTime),
    durationSeconds: Number(row.durationSeconds),
    distanceMeters: row.distanceMeters,
    elevationGain: row.elevationGain ?? undefined,
    avgHeartrate: row.avgHeartrate ?? undefined,
    pairedEventId: row.pairedEventId === undefined ? undefined : Number(row.pairedEventId),
    createdAt: Number(row.createdAt),
    uploadStatus: row.uploadStatus,
    retryCount: row.retryCount,
    lastAttemptAt: row.lastAttemptAt === undefined ? undefined : Number(row.lastAttemptAt),
    lastError: row.lastError ?? undefined,
    intervalsActivityId: row.intervalsActivityId ?? undefined,
    engineActivityId: row.engineActivityId ?? undefined,
    engineReconciled: row.engineReconciled,
    athleteId: row.athleteId ?? undefined,
    notes: row.notes ?? undefined,
    rpe: row.rpe ?? undefined,
    rpeSent: row.rpeSent,
  });
}

function toRow(entry: RecordingEntry): FfiRecordingEntry {
  return present({
    id: entry.id,
    kind: entry.kind,
    fitPath: entry.fitPath,
    streamsPath: entry.streamsPath,
    activityType: entry.activityType,
    name: entry.name,
    startTime: Math.trunc(entry.startTime),
    durationSeconds: Math.trunc(entry.durationSeconds),
    distanceMeters: entry.distanceMeters,
    elevationGain: entry.elevationGain,
    avgHeartrate: entry.avgHeartrate,
    pairedEventId: entry.pairedEventId,
    createdAt: Math.trunc(entry.createdAt),
    uploadStatus: entry.uploadStatus,
    retryCount: entry.retryCount,
    lastAttemptAt: entry.lastAttemptAt === undefined ? undefined : Math.trunc(entry.lastAttemptAt),
    lastError: entry.lastError,
    intervalsActivityId: entry.intervalsActivityId,
    engineActivityId: entry.engineActivityId,
    engineReconciled: entry.engineReconciled,
    athleteId: entry.athleteId,
    notes: entry.notes,
    rpe: entry.rpe,
    rpeSent: entry.rpeSent,
  });
}

/** Add a recording. False means a row with that id was already there. */
export function addRecording(host: DelegateHost, entry: RecordingEntry): boolean {
  if (!host.ready) throw new Error('Engine not initialized');
  return host.timed('addRecording', () => host.engine.recordings().addRecording(toRow(entry)));
}

/** Every recording, newest first. */
export function listRecordings(host: DelegateHost): RecordingEntry[] {
  if (!host.ready) return [];
  return host.timed('listRecordings', () => host.engine.recordings().listRecordings()).map(toEntry);
}

export function getRecording(host: DelegateHost, id: string): RecordingEntry | null {
  if (!host.ready) return null;
  const row = host.timed('getRecording', () => host.engine.recordings().getRecording(id));
  return row ? toEntry(row) : null;
}

/** Every recording the athlete may see, newest first: theirs and unstamped ones. */
export function listVisibleRecordings(
  host: DelegateHost,
  athleteId: string | undefined
): RecordingEntry[] {
  if (!host.ready) return [];
  return host
    .timed('listVisibleRecordings', () => host.engine.recordings().listVisibleRecordings(athleteId))
    .map(toEntry);
}

/** One recording, null when it is stamped with another athlete. */
export function getVisibleRecording(
  host: DelegateHost,
  id: string,
  athleteId: string | undefined
): RecordingEntry | null {
  if (!host.ready) return null;
  const row = host.timed('getVisibleRecording', () =>
    host.engine.recordings().getVisibleRecording(id, athleteId)
  );
  return row ? toEntry(row) : null;
}

export function unuploadedVisibleRecordingCount(
  host: DelegateHost,
  athleteId: string | undefined
): number {
  if (!host.ready) return 0;
  return host.timed('unuploadedVisibleRecordingCount', () =>
    host.engine.recordings().unuploadedVisibleCount(athleteId)
  );
}

export function attachRecordingEngineActivity(
  host: DelegateHost,
  id: string,
  engineActivityId: string
): void {
  host.write('attachRecordingEngineActivity', () =>
    host.engine.recordings().attachEngineActivity(id, engineActivityId)
  );
}

/** The engine row has taken the id intervals.icu gave the upload. */
export function markRecordingReconciled(host: DelegateHost, id: string): void {
  host.write('markRecordingReconciled', () => host.engine.recordings().markReconciled(id));
}

/** intervals.icu has the effort the athlete set. */
export function markRecordingRpeSent(host: DelegateHost, id: string): void {
  host.write('markRecordingRpeSent', () => host.engine.recordings().markRpeSent(id));
}

/**
 * An athlete signed in: stop auto-uploading every ride that is not theirs, an
 * unstamped one included.
 *
 * It goes through `write` and not `timed`, so a sign-in that lands before the
 * engine opens is held and replayed rather than dropped. That is also why it
 * answers nothing: the count is not known until the write actually runs.
 */
export function holdRecordingsOfOtherAthletes(host: DelegateHost, athleteId: string): void {
  host.write('holdRecordingsOfOtherAthletes', () =>
    host.engine.recordings().holdOtherAthletes(athleteId)
  );
}

/**
 * One move of one recording's upload. Every outcome carries `install`, the
 * install the begin it settles answered, so an outcome that outlived a restore
 * or a wipe is refused instead of written into another library.
 */
export type RecordingTransition =
  | { kind: 'begin' }
  | { kind: 'requeue' }
  | { kind: 'uploaded'; install: number; intervalsActivityId?: string | undefined }
  | {
      kind: 'failed' | 'rejected' | 'heldForAuth' | 'heldForNetwork';
      install: number;
      error: string;
    }
  | { kind: 'permissionBlocked'; install: number };

/** What a transition did. A refusal is an answer: nothing was written. */
export interface RecordingTransitionAnswer {
  applied: boolean;
  /** Why nothing was written, absent when the move applied. */
  refusal?:
    | 'NoRecording'
    | 'IllegalTransition'
    | 'AnotherActivity'
    | 'AnotherInstall'
    | 'EngineNotReady'
    | undefined;
  /** The upload status the row was in when the transition read it. */
  found?: string | undefined;
  /** The attempts counted against the ride now. */
  retryCount: number;
  /** The install the transition ran under. A begin's answer is the attempt. */
  install: number;
}

function toEngineTransition(transition: RecordingTransition): UploadTransition {
  switch (transition.kind) {
    case 'begin':
      return UploadTransition.Begin.new();
    case 'requeue':
      return UploadTransition.Requeue.new();
    case 'uploaded':
      return UploadTransition.Uploaded.new({
        install: transition.install,
        ...(transition.intervalsActivityId !== undefined && {
          intervalsActivityId: transition.intervalsActivityId,
        }),
      });
    case 'failed':
      return UploadTransition.Failed.new({ install: transition.install, error: transition.error });
    case 'rejected':
      return UploadTransition.Rejected.new({
        install: transition.install,
        error: transition.error,
      });
    case 'heldForAuth':
      return UploadTransition.HeldForAuth.new({
        install: transition.install,
        error: transition.error,
      });
    case 'heldForNetwork':
      return UploadTransition.HeldForNetwork.new({
        install: transition.install,
        error: transition.error,
      });
    case 'permissionBlocked':
      return UploadTransition.PermissionBlocked.new({ install: transition.install });
    default:
      return transition satisfies never;
  }
}

/**
 * Move one recording's upload by a named transition, if the engine's table
 * allows it from the state the row is in. Before the engine opens nothing is
 * written and the answer says so.
 */
export function transitionRecording(
  host: DelegateHost,
  id: string,
  transition: RecordingTransition,
  nowMs: number
): RecordingTransitionAnswer {
  if (!host.ready) {
    return { applied: false, refusal: 'EngineNotReady', retryCount: 0, install: 0 };
  }
  const answer = host.timed('transitionRecording', () =>
    host.engine.recordings().transition(id, toEngineTransition(transition), nowMs)
  );
  return {
    applied: answer.applied,
    ...(answer.refusal !== undefined && {
      refusal: UploadRefusal[answer.refusal] as RecordingTransitionAnswer['refusal'],
    }),
    found: answer.found ?? undefined,
    retryCount: answer.retryCount,
    install: answer.install,
  };
}

/**
 * Name the library's athlete on every ride adopted from an older build's
 * storage with none. Rows of another athlete and every upload status stay as
 * they are.
 */
export function stampOwnerlessRecordings(host: DelegateHost, athleteId: string): void {
  host.write('stampOwnerlessRecordings', () => host.engine.recordings().stampOwnerless(athleteId));
}

/** Requeue the permission-blocked rides of the athlete whose scope grew, and nobody else's. */
export function clearRecordingPermissionBlocked(host: DelegateHost, athleteId: string): void {
  host.write('clearRecordingPermissionBlocked', () =>
    host.engine.recordings().clearPermissionBlocked(athleteId)
  );
}

/**
 * Start the engine's upload schedule if it is not running, and wake it. The
 * schedule uploads each pending ride itself once it is due.
 */
export function wakeUploadSchedule(host: DelegateHost): void {
  host.write('wakeUploadSchedule', () => host.engine.recordings().wakeUploadSchedule());
}

/**
 * Upload one recording now, the whole sequence the schedule runs for a due
 * ride. `manual` is the athlete asking: a parked ride is requeued first.
 *
 * Resolves to the outcome rather than rejecting, and skips `host.timed`
 * because that measures the dispatch, not the request the promise waits on.
 * Before the engine exists nothing was started.
 */
export function uploadRecording(
  host: DelegateHost,
  id: string,
  manual: boolean
): Promise<FfiUploadResult> {
  if (!host.ready) {
    return Promise.resolve({ outcome: FfiUploadOutcome.NotStarted });
  }
  return host.engine.recordings().uploadRecording(id, manual);
}

/**
 * Remove a recording the athlete may see, answering the row so its files can
 * be deleted too. A row stamped with another athlete is left and answers null.
 */
export function deleteOwnRecording(
  host: DelegateHost,
  id: string,
  athleteId: string | undefined
): RecordingEntry | null {
  if (!host.ready) return null;
  const row = host.timed('deleteOwnRecording', () =>
    host.engine.recordings().deleteOwnRecording(id, athleteId)
  );
  return row ? toEntry(row) : null;
}

/**
 * Drop every row. A `.veloqdb` restore carries this table like any other but
 * not the FIT files it points at, so the rows are stale the moment they land.
 */
export function clearRecordings(host: DelegateHost): void {
  host.write('clearRecordings', () => host.engine.recordings().clearRecordings());
}
