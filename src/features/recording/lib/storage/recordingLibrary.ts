import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import type {
  ActivityType,
  RecordingLibraryEntry,
  RecordingStreams,
  RecordingUploadStatus,
} from '@/types';

const log = debug.create('RecordingLibrary');

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;
/**
 * The index lived under this key until it became a table. It is read once
 * more, to adopt whatever a released install still holds, and then removed.
 */
const LEGACY_INDEX_KEY = 'veloq-recording-library';
const LEGACY_QUEUE_KEY = 'veloq-upload-queue';
const LEGACY_UPLOADS_DIR = `${FileSystem.documentDirectory}pending_uploads/`;

/**
 * Automatic retries before an entry parks as 'failed' (manual retry only). A
 * failed upload never loses its FIT. The engine applies this; the copy here is
 * what the library screen tells the athlete.
 */
export const MAX_AUTO_RETRIES = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The engine's row shape and the app's differ in one way that matters: the row
 * carries an open `string` status and a `string` activity type, because Rust
 * does not own either vocabulary.
 */
type EngineEntry = ReturnType<ReturnType<typeof library>['listRecordings']>[number];

/**
 * The app's entry as the engine row wants it. Two fields differ and both are
 * the app's looseness, not the engine's: an absent average heart rate is an
 * absent field rather than a recorded `null`, and a row adopted from the old
 * AsyncStorage index carries no reconcile flag, which reads as owing one.
 */
function toEngineEntry(entry: RecordingLibraryEntry): EngineEntry {
  return {
    ...entry,
    avgHeartrate: entry.avgHeartrate ?? undefined,
    engineReconciled: entry.engineReconciled ?? false,
  };
}

function toLibraryEntry(row: EngineEntry): RecordingLibraryEntry {
  return {
    ...row,
    activityType: row.activityType as ActivityType,
    uploadStatus: row.uploadStatus as RecordingUploadStatus,
  };
}

/**
 * The engine, or a throw. The index is the only record of a recording the
 * server does not have yet, so a caller that cannot reach it must hear so
 * rather than read an empty library as "nothing recorded".
 */
function library(): NonNullable<ReturnType<typeof getEngine>> {
  const engine = getEngine();
  if (!engine) throw new Error('Engine not initialized');
  return engine;
}

async function ensureRecordingsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    log.log('Created recordings directory');
  }
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * Whether a pending entry is eligible for an automatic retry right now.
 *
 * The engine applies this when it picks the next upload. This is the same rule
 * for a caller holding an entry it already has, so the screen does not make a
 * round trip to grey out a button.
 */
export function isRetryEligible(entry: RecordingLibraryEntry, now: number): boolean {
  if (entry.uploadStatus !== 'pending') return false;
  if (!entry.lastAttemptAt) return true;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** entry.retryCount, BACKOFF_CAP_MS);
  return now - entry.lastAttemptAt >= delay;
}

// ─── Save / read ──────────────────────────────────────────────────────────────

export interface SaveRecordingParams {
  fitBuffer: ArrayBuffer;
  streams?: RecordingStreams;
  activityType: ActivityType;
  name: string;
  startTime: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGain?: number;
  avgHeartrate?: number | null;
  pairedEventId?: number;
  uploadStatus: Extract<RecordingUploadStatus, 'pending' | 'localOnly'>;
}

/**
 * Persist a completed recording: FIT file (+ optional streams sidecar for the
 * detail view) plus an index entry. The FIT is the durable copy until the upload
 * succeeds, and no retry ever deletes it. Once intervals.icu holds the activity
 * the FIT has no reader left, and `discardRecordingFit` takes it. The sidecar
 * stays: it is what the detail view renders from.
 */
export async function saveRecording(
  params: SaveRecordingParams
): Promise<RecordingLibraryEntry | null> {
  try {
    await ensureRecordingsDir();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fitPath = `${RECORDINGS_DIR}${id}.fit`;
    await FileSystem.writeAsStringAsync(fitPath, bufferToBase64(params.fitBuffer), {
      encoding: FileSystem.EncodingType.Base64,
    });

    let streamsPath: string | undefined;
    if (params.streams) {
      streamsPath = `${RECORDINGS_DIR}${id}.streams.json`;
      await FileSystem.writeAsStringAsync(streamsPath, JSON.stringify(params.streams));
    }

    const entry: RecordingLibraryEntry = {
      id,
      fitPath,
      streamsPath,
      activityType: params.activityType,
      name: params.name,
      startTime: params.startTime,
      durationSeconds: params.durationSeconds,
      distanceMeters: params.distanceMeters,
      elevationGain: params.elevationGain,
      avgHeartrate: params.avgHeartrate,
      pairedEventId: params.pairedEventId,
      createdAt: Date.now(),
      uploadStatus: params.uploadStatus,
      retryCount: 0,
      // Whose ride this is, read once at save time. A forced sign-out holds
      // pending entries instead of demoting them, so this is what keeps one
      // athlete's recording out of the next athlete's account.
      athleteId: getStoredCredentials().athleteId ?? undefined,
    };

    library().addRecording(toEngineEntry(entry));
    log.log(`Saved recording ${id} (${params.name}, ${params.uploadStatus})`);
    return entry;
  } catch (error) {
    log.error('Failed to save recording:', error);
    return null;
  }
}

/** All recordings, newest first. */
export async function listRecordings(): Promise<RecordingLibraryEntry[]> {
  return library().listRecordings().map(toLibraryEntry);
}

export async function getRecording(id: string): Promise<RecordingLibraryEntry | null> {
  const row = library().getRecording(id);
  return row ? toLibraryEntry(row) : null;
}

/**
 * Whether the FIT file is still on disk. The upload path streams the file from
 * Rust, so it needs to know the file is there without reading it into memory.
 */
export async function recordingFitExists(entry: RecordingLibraryEntry): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(entry.fitPath);
    return info.exists;
  } catch {
    return false;
  }
}

export async function readRecordingFit(entry: RecordingLibraryEntry): Promise<ArrayBuffer | null> {
  try {
    const info = await FileSystem.getInfoAsync(entry.fitPath);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(entry.fitPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToBuffer(base64);
  } catch {
    return null;
  }
}

export async function readRecordingStreams(
  entry: RecordingLibraryEntry
): Promise<RecordingStreams | null> {
  if (!entry.streamsPath) return null;
  try {
    const info = await FileSystem.getInfoAsync(entry.streamsPath);
    if (!info.exists) return null;
    const data = await FileSystem.readAsStringAsync(entry.streamsPath);
    return JSON.parse(data) as RecordingStreams;
  } catch {
    return null;
  }
}

// ─── Status transitions ───────────────────────────────────────────────────────

/**
 * Remember the engine key the recording was written under. It lives in the
 * index so a background retry can still reconcile the upload.
 */
export async function attachEngineActivity(
  id: string,
  engineActivityId: string
): Promise<RecordingLibraryEntry | null> {
  library().attachRecordingEngineActivity(id, engineActivityId);
  return getRecording(id);
}

/** The engine row now carries the id intervals.icu gave the upload. */
export async function markRecordingReconciled(id: string): Promise<RecordingLibraryEntry | null> {
  library().markRecordingReconciled(id);
  return getRecording(id);
}

export async function markRecordingUploading(id: string): Promise<void> {
  library().markRecordingUploading(id);
}

export async function markRecordingUploaded(id: string, intervalsActivityId?: string) {
  library().markRecordingUploaded(id, intervalsActivityId);
  log.log(`Recording uploaded: ${id}`);
}

/**
 * Record a retriable upload failure. The entry stays 'pending' until automatic
 * retries are exhausted, then parks as 'failed' for manual retry. The FIT file
 * is always kept.
 */
export async function markRecordingUploadFailed(id: string, error: string): Promise<void> {
  const retryCount = library().markRecordingUploadFailed(id, error, Date.now());
  log.log(`Upload failed for ${id} (retry ${retryCount}/${MAX_AUTO_RETRIES}): ${error}`);
}

/** A server-side rejection that automatic retries cannot fix. */
export async function markRecordingRejected(id: string, error: string): Promise<void> {
  library().markRecordingRejected(id, error, Date.now());
  log.warn(`Upload rejected for ${id}: ${error}`);
}

export async function markRecordingPermissionBlocked(id: string): Promise<void> {
  library().markRecordingPermissionBlocked(id, Date.now());
}

/**
 * A credential was refused mid-upload. The ride goes back in the queue with its
 * attempt count intact: a 401 says nothing about the ride, and spending one of
 * its attempts on a dead credential would retire a recording the server never
 * saw.
 */
export async function holdRecordingForAuth(id: string, error: string): Promise<void> {
  library().holdRecordingForAuth(id, error);
  log.log(`Holding ${id}: the credential was refused`);
}

/**
 * An athlete signed in: stop auto-uploading every ride that is not theirs.
 *
 * What they recorded keeps its place in the queue. A ride stamped with someone
 * else, and an unstamped one from before the stamp existed, becomes local-only,
 * so nothing lands in the wrong account. Neither is deleted, and either can
 * still be sent up by hand.
 */
export async function holdRecordingsOfOtherAthletes(athleteId: string): Promise<number> {
  const held = library().holdRecordingsOfOtherAthletes(athleteId);
  if (held > 0) log.log(`Held ${held} recording(s) belonging to another athlete`);
  return held;
}

/** Manual retry (or post-upgrade requeue): back to 'pending' with a clean slate. */
export async function requeueRecording(id: string): Promise<void> {
  library().requeueRecording(id);
}

/** After an OAuth write upgrade, everything permission-blocked becomes uploadable. */
export async function clearPermissionBlocked(): Promise<void> {
  library().clearRecordingPermissionBlocked();
  log.log('Cleared permission-blocked recordings');
}

/**
 * On logout: keep every recording on device, but stop auto-uploading so
 * nothing lands in a different account after the next login.
 */
export async function demotePendingToLocalOnly(): Promise<void> {
  library().demoteRecordingsToLocalOnly();
  log.log('Demoted pending uploads to local-only');
}

/** Next entry eligible for automatic upload, respecting exponential backoff. */
export async function nextPendingUpload(now = Date.now()): Promise<RecordingLibraryEntry | null> {
  const row = library().nextPendingRecording(now);
  return row ? toLibraryEntry(row) : null;
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

/**
 * Drop the FIT bytes once intervals.icu has the activity. The file exists to be
 * uploaded, so keeping it grows the device by every recording the athlete has
 * ever made. The streams sidecar and the index entry stay, which is what the
 * library and its detail view read.
 *
 * Best effort by design: the upload succeeded either way, and a delete that
 * throws must not turn a finished upload into a retry.
 */
export async function discardRecordingFit(id: string): Promise<void> {
  const entry = library().getRecording(id);
  if (!entry) return;
  try {
    await FileSystem.deleteAsync(entry.fitPath, { idempotent: true });
    log.log(`Discarded FIT for uploaded recording ${id}`);
  } catch {
    // The next discard, or the user's own delete, gets it.
  }
}

/**
 * Drop the streams sidecar once the engine holds the ride's track. It is the
 * last file that grows with every recording, and the detail view reads the
 * engine first. The path is cleared with it, so nothing looks for the file.
 *
 * Best effort by design, the same as the FIT: a delete that throws must not
 * turn a finished upload into a retry.
 */
export async function discardRecordingStreams(id: string): Promise<void> {
  const row = library().getRecording(id);
  const path = row?.streamsPath;
  if (!path) return;
  // The row stops naming the file before the file goes, never after: a delete
  // that succeeds against a row still pointing at it leaves the library
  // looking for a path that is not there.
  library().clearRecordingStreamsPath(id);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
    log.log(`Discarded streams sidecar for uploaded recording ${id}`);
  } catch {
    // The row no longer names it, and the user's own delete gets the file.
  }
}

// ─── Deletion (user-initiated only) ──────────────────────────────────────────

export async function deleteRecording(id: string): Promise<void> {
  const entry = library().deleteRecording(id);
  if (!entry) return;
  for (const path of [entry.fitPath, entry.streamsPath]) {
    if (!path) continue;
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // Best effort cleanup
    }
  }
  log.log(`Deleted recording ${id}`);
}

// ─── Counts ───────────────────────────────────────────────────────────────────

/** Recordings not yet on intervals.icu (any status except 'uploaded'). */
export async function getUnuploadedCount(): Promise<number> {
  return library().unuploadedRecordingCount();
}

export async function getPermissionBlockedCount(): Promise<number> {
  return library().permissionBlockedRecordingCount();
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

/**
 * Adopt the AsyncStorage index into the table, once.
 *
 * Runs after `migrateLegacyUploadQueue`, not instead of it: a released install
 * may still be arriving through the old `veloq-upload-queue`, and that path
 * writes into the index this one then reads. Insert-if-absent, so a partial
 * run that is interrupted before the key is removed adopts the rest next time
 * without duplicating what it already took.
 */
export async function adoptAsyncStorageIndex(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(LEGACY_INDEX_KEY);
    if (!stored) return 0;

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      await AsyncStorage.removeItem(LEGACY_INDEX_KEY);
      return 0;
    }

    let adopted = 0;
    for (const entry of parsed as RecordingLibraryEntry[]) {
      // An entry with no id has no row to be, and nothing can find it again.
      if (!entry?.id || !entry.fitPath) continue;
      if (library().addRecording(toEngineEntry(entry))) adopted += 1;
    }

    await AsyncStorage.removeItem(LEGACY_INDEX_KEY);
    log.log(`Adopted ${adopted} recording(s) from the AsyncStorage index`);
    return adopted;
  } catch (error) {
    // Leave the key in place: the next launch tries again rather than losing
    // the only record of a recording that has not been uploaded.
    log.warn('Recording index adoption failed:', error);
    return 0;
  }
}

interface LegacyQueueEntry {
  id: string;
  filePath: string;
  activityType: ActivityType;
  name: string;
  pairedEventId?: number;
  createdAt: number;
  retryCount: number;
  lastError?: string;
  permissionBlocked?: boolean;
}

/**
 * One-off adoption of the old pending_uploads queue into the library. Files
 * move into the recordings dir; entries become 'pending' (or
 * 'permissionBlocked') with metadata reconstructed from what the queue knew.
 */
export async function migrateLegacyUploadQueue(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
    if (!stored) return;

    const legacy = JSON.parse(stored) as LegacyQueueEntry[];
    await ensureRecordingsDir();

    for (const old of legacy) {
      try {
        const info = await FileSystem.getInfoAsync(old.filePath);
        if (!info.exists) continue;
        const fitPath = `${RECORDINGS_DIR}${old.id}.fit`;
        await FileSystem.moveAsync({ from: old.filePath, to: fitPath });

        const entry: RecordingLibraryEntry = {
          id: old.id,
          fitPath,
          activityType: old.activityType,
          name: old.name,
          startTime: old.createdAt,
          durationSeconds: 0,
          distanceMeters: 0,
          pairedEventId: old.pairedEventId,
          createdAt: old.createdAt,
          uploadStatus: old.permissionBlocked ? 'permissionBlocked' : 'pending',
          retryCount: 0,
          lastError: old.lastError,
        };
        library().addRecording(toEngineEntry(entry));
      } catch (err) {
        log.warn(`Failed to migrate legacy upload ${old.id}:`, err);
      }
    }

    await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
    try {
      const dirInfo = await FileSystem.getInfoAsync(LEGACY_UPLOADS_DIR);
      if (dirInfo.exists) await FileSystem.deleteAsync(LEGACY_UPLOADS_DIR, { idempotent: true });
    } catch {
      // Best effort cleanup
    }
    log.log(`Migrated ${legacy.length} legacy queued upload(s) into the library`);
  } catch (error) {
    log.warn('Legacy upload queue migration failed:', error);
  }
}
