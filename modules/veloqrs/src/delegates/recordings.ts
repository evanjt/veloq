/**
 * Recording index delegates.
 *
 * The index is a table, not a JSON blob under a lock: two writers racing is
 * what SQLite answers, and the retry policy lives beside the state it reads.
 * The FIT file and a manual entry's body stay the caller's to write and delete.
 */

import { FfiStrengthFinish_Tags, FfiUploadOutcome } from '../generated/veloqrs';
import type {
  FfiLivePace,
  FfiRecordingEntry,
  FfiRecordingFit,
  FfiUploadResult,
} from '../generated/veloqrs';
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
  if (!host.ready) throw new Error('Engine not initialised');
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
 * Name the library's athlete on every ride adopted from an older build's
 * storage with none. Rows of another athlete and every upload status stay as
 * they are.
 */
export function stampOwnerlessRecordings(host: DelegateHost, athleteId: string): void {
  host.write('stampOwnerlessRecordings', () => host.engine.recordings().stampOwnerless(athleteId));
}

/** Move the rides of an adopted library's old identity to the identity that adopted it. */
export function adoptRecordingsIdentity(host: DelegateHost, from: string, to: string): void {
  host.write('adoptRecordingsIdentity', () => host.engine.recordings().adoptIdentity(from, to));
}

/** Requeue the permission-blocked rides of the athlete whose scope grew, and nobody else's. */
export function clearRecordingPermissionBlocked(host: DelegateHost, athleteId: string): void {
  host.write('clearRecordingPermissionBlocked', () =>
    host.engine.recordings().clearPermissionBlocked(athleteId)
  );
}

/**
 * Start the engine's upload schedule if it is not running, and wake it. The
 * schedule uploads each pending ride itself once it is due, finding its files
 * under `filesRoot`, the app's documents directory as it is now.
 */
export function wakeUploadSchedule(host: DelegateHost, filesRoot: string): void {
  host.write('wakeUploadSchedule', () => host.engine.recordings().wakeUploadSchedule(filesRoot));
}

/**
 * Upload one recording now, the whole sequence the schedule runs for a due
 * ride. `manual` is the athlete asking: a parked ride is requeued first.
 * `filesRoot` is the app's documents directory as it is now, which the row's
 * file names are relative to.
 *
 * Resolves to the outcome rather than rejecting, and skips `host.timed`
 * because that measures the dispatch, not the request the promise waits on.
 * Before the engine exists nothing was started.
 */
export function uploadRecording(
  host: DelegateHost,
  id: string,
  manual: boolean,
  filesRoot: string
): Promise<FfiUploadResult> {
  if (!host.ready) {
    return Promise.resolve({ outcome: FfiUploadOutcome.NotStarted });
  }
  return host.engine.recordings().uploadRecording(id, manual, filesRoot);
}

/** How finishing the live strength session ended. */
export type StrengthFinishResult = { kind: 'finished'; entry: RecordingEntry } | { kind: 'noSets' };

/**
 * Finish the live strength session as the recording `recordingId`. The engine
 * writes the FIT of the done sets in the athlete's own weight unit under
 * `filesRoot`, finishes the session under the recording's key and adds the
 * row, which the upload then sends and relinks. A session with no done set
 * answers `noSets` and stays live. `nowSeconds` is Unix seconds, `rpe` the
 * effort from 1 to 10.
 */
export function finishStrengthRecording(
  host: DelegateHost,
  input: {
    recordingId: string;
    name: string;
    athleteId: string | undefined;
    nowSeconds: number;
    rpe: number | undefined;
    /** The row waits on the device instead of joining the upload queue. */
    keepOnDevice: boolean;
    filesRoot: string;
  }
): StrengthFinishResult {
  if (!host.ready) throw new Error('Engine not initialised');
  const answer = host.timed('finishStrengthRecording', () =>
    host.engine
      .recordings()
      .finishStrengthRecording(
        input.recordingId,
        input.name,
        input.athleteId,
        input.nowSeconds,
        input.rpe,
        input.keepOnDevice,
        input.filesRoot
      )
  );
  return answer.tag === FfiStrengthFinish_Tags.Finished
    ? { kind: 'finished', entry: toEntry(answer.inner.entry) }
    : { kind: 'noSets' };
}

/**
 * The FIT file of a recorded activity, written by the engine from the streams
 * and laps the recording store holds. Nothing is stored: the caller writes the
 * bytes under the recording's file name. The call blocks for the whole write,
 * so it belongs on the save tap, where a transition is already running.
 */
export function writeRecordingFit(host: DelegateHost, recording: FfiRecordingFit): ArrayBuffer {
  if (!host.ready) throw new Error('Engine not initialised');
  return host.timed('writeRecordingFit', () =>
    host.engine.recordings().writeRecordingFit(recording)
  );
}

/**
 * The pace a live recording shows for a speed in metres per second, and the
 * seconds behind it. Pure arithmetic in the engine, read once a second for
 * each figure on screen, so it belongs inside a mount or tap budget. Before the
 * engine opens it answers the no-pace text.
 */
export function livePace(
  host: DelegateHost,
  metersPerSecond: number,
  activityType: string | undefined,
  isMetric: boolean
): FfiLivePace {
  if (!host.ready) return { text: '--:--' };
  return host.timed(
    'livePace',
    () => host.engine.recordings().livePace(metersPerSecond, activityType, isMetric),
    'tap'
  );
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
