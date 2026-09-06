/**
 * Recording index delegates.
 *
 * The index is a table, not a JSON blob under a lock: two writers racing is
 * what SQLite answers, and the retry policy lives beside the state it reads.
 * The FIT file and the streams sidecar stay the caller's to write and delete.
 */

import type { FfiRecordingEntry } from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * One recording, with its epoch milliseconds as numbers.
 *
 * The generated record carries `i64` as `bigint`, which no caller here wants:
 * every one of these fits a double exactly and the screens do arithmetic on
 * them. Converted at this boundary, the way the weekly summaries are.
 */
export interface RecordingEntry {
  id: string;
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
}

function toEntry(row: FfiRecordingEntry): RecordingEntry {
  return {
    id: row.id,
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
  };
}

function toRow(entry: RecordingEntry): FfiRecordingEntry {
  return {
    id: entry.id,
    fitPath: entry.fitPath,
    streamsPath: entry.streamsPath,
    activityType: entry.activityType,
    name: entry.name,
    startTime: BigInt(Math.trunc(entry.startTime)),
    durationSeconds: BigInt(Math.trunc(entry.durationSeconds)),
    distanceMeters: entry.distanceMeters,
    elevationGain: entry.elevationGain,
    avgHeartrate: entry.avgHeartrate,
    pairedEventId: entry.pairedEventId === undefined ? undefined : BigInt(entry.pairedEventId),
    createdAt: BigInt(Math.trunc(entry.createdAt)),
    uploadStatus: entry.uploadStatus,
    retryCount: entry.retryCount,
    lastAttemptAt:
      entry.lastAttemptAt === undefined ? undefined : BigInt(Math.trunc(entry.lastAttemptAt)),
    lastError: entry.lastError,
    intervalsActivityId: entry.intervalsActivityId,
    engineActivityId: entry.engineActivityId,
  };
}

/** Add a recording. False means a row with that id was already there. */
export function addRecording(host: DelegateHost, entry: RecordingEntry): boolean {
  if (!host.ready) return false;
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

export function attachRecordingEngineActivity(
  host: DelegateHost,
  id: string,
  engineActivityId: string
): void {
  host.write('attachRecordingEngineActivity', () =>
    host.engine.recordings().attachEngineActivity(id, engineActivityId)
  );
}

export function markRecordingUploading(host: DelegateHost, id: string): void {
  host.write('markRecordingUploading', () => host.engine.recordings().markUploading(id));
}

export function markRecordingUploaded(
  host: DelegateHost,
  id: string,
  intervalsActivityId?: string
): void {
  host.write('markRecordingUploaded', () =>
    host.engine.recordings().markUploaded(id, intervalsActivityId)
  );
}

/** A retriable failure. Answers the attempt count the entry now stands at. */
export function markRecordingUploadFailed(
  host: DelegateHost,
  id: string,
  error: string,
  nowMs: number
): number {
  if (!host.ready) return 0;
  return host.timed('markRecordingUploadFailed', () =>
    host.engine.recordings().markUploadFailed(id, error, BigInt(Math.trunc(nowMs)))
  );
}

export function markRecordingRejected(
  host: DelegateHost,
  id: string,
  error: string,
  nowMs: number
): void {
  host.write('markRecordingRejected', () => host.engine.recordings().markRejected(id, error, BigInt(Math.trunc(nowMs))));
}

export function markRecordingPermissionBlocked(
  host: DelegateHost,
  id: string,
  nowMs: number
): void {
  host.write('markRecordingPermissionBlocked', () =>
    host.engine.recordings().markPermissionBlocked(id, BigInt(Math.trunc(nowMs)))
  );
}

export function requeueRecording(host: DelegateHost, id: string): void {
  host.write('requeueRecording', () => host.engine.recordings().requeue(id));
}

export function clearRecordingPermissionBlocked(host: DelegateHost): void {
  host.write('clearRecordingPermissionBlocked', () =>
    host.engine.recordings().clearPermissionBlocked()
  );
}

export function demoteRecordingsToLocalOnly(host: DelegateHost): void {
  host.write('demoteRecordingsToLocalOnly', () =>
    host.engine.recordings().demotePendingToLocalOnly()
  );
}

/** The next recording due an automatic upload, respecting the backoff. */
export function nextPendingRecording(host: DelegateHost, nowMs: number): RecordingEntry | null {
  if (!host.ready) return null;
  const row = host.timed('nextPendingRecording', () =>
    host.engine.recordings().nextPendingUpload(BigInt(Math.trunc(nowMs)))
  );
  return row ? toEntry(row) : null;
}

/** Remove a recording, answering the row so its files can be deleted too. */
export function deleteRecording(host: DelegateHost, id: string): RecordingEntry | null {
  if (!host.ready) return null;
  const row = host.timed('deleteRecording', () => host.engine.recordings().deleteRecording(id));
  return row ? toEntry(row) : null;
}

export function unuploadedRecordingCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('unuploadedRecordingCount', () =>
    host.engine.recordings().unuploadedCount()
  );
}

export function permissionBlockedRecordingCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('permissionBlockedRecordingCount', () =>
    host.engine.recordings().permissionBlockedCount()
  );
}

/**
 * Drop every row. A `.veloqdb` restore carries this table like any other but
 * not the FIT files it points at, so the rows are stale the moment they land.
 */
export function clearRecordings(host: DelegateHost): void {
  host.write('clearRecordings', () => host.engine.recordings().clearRecordings());
}
