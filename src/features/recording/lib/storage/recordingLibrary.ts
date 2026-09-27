import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';
import { present } from 'veloqrs/src/delegates/optional';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import type {
  ActivityType,
  ManualActivityData,
  RecordingKind,
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

// Automatic retry limit read by the failed-upload log line.
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
  const { avgHeartrate, ...rest } = entry;
  return {
    ...rest,
    ...(avgHeartrate != null && { avgHeartrate }),
    engineReconciled: entry.engineReconciled ?? false,
  };
}

function toLibraryEntry(row: EngineEntry): RecordingLibraryEntry {
  return {
    ...row,
    activityType: row.activityType as ActivityType,
    uploadStatus: row.uploadStatus as RecordingUploadStatus,
    // The column is NOT NULL with a 'fit' default, so anything else is a row
    // this build does not know about and a FIT is the safe reading.
    kind: row.kind === 'manual' ? 'manual' : 'fit',
  };
}

/**
 * The engine, or a throw. The index is the only record of a recording the
 * server does not have yet, so a caller that cannot reach it must hear so
 * rather than read an empty library as "nothing recorded".
 */
function library(requireReady = false): NonNullable<ReturnType<typeof getEngine>> {
  const engine = getEngine();
  if (!engine || (requireReady && !engine.ready)) throw new Error('Engine not initialized');
  return engine;
}

async function ensureRecordingsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    log.log('Created recordings directory');
  }
}

/**
 * How many bytes go through `String.fromCharCode` at once. Small enough to
 * stay inside the argument limit, large enough that a multi-megabyte FIT is
 * a few hundred joins rather than a few million.
 */
const BASE64_CHUNK = 8192;

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Built per chunk and joined once. Appending a character at a time
  // reallocated the string on every byte of a long ride's FIT file, on the
  // JS thread while the athlete waits on the save.
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(chunks.join(''));
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// ─── Save / read ──────────────────────────────────────────────────────────────

export interface SaveRecordingParams {
  /** Absent for a manual entry, which has no file to write. */
  fitBuffer?: ArrayBuffer | undefined;
  /**
   * The request body a manual entry will post, stored beside the row so the
   * entry survives a relaunch and drains through the same queue.
   */
  manualBody?: ManualActivityData | undefined;
  streams?: RecordingStreams | undefined;
  activityType: ActivityType;
  name: string;
  startTime: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGain?: number | undefined;
  avgHeartrate?: number | null | undefined;
  pairedEventId?: number | undefined;
  uploadStatus: Extract<RecordingUploadStatus, 'pending' | 'localOnly'>;
}

// Keep the FIT, sidecar and index until confirmation reads the activity back.
export async function saveRecording(
  params: SaveRecordingParams
): Promise<RecordingLibraryEntry | null> {
  try {
    library(true);
    await ensureRecordingsDir();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const manual = params.manualBody !== undefined;

    // A manual entry names no file. The column cannot hold a null, so the empty
    // string is what "no FIT" looks like, and `kind` is what the upload reads.
    let fitPath = '';
    if (params.fitBuffer) {
      fitPath = `${RECORDINGS_DIR}${id}.fit`;
      await FileSystem.writeAsStringAsync(fitPath, bufferToBase64(params.fitBuffer), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    let streamsPath: string | undefined;
    if (manual) {
      streamsPath = `${RECORDINGS_DIR}${id}.manual.json`;
      await FileSystem.writeAsStringAsync(streamsPath, JSON.stringify(params.manualBody));
    } else if (params.streams) {
      streamsPath = `${RECORDINGS_DIR}${id}.streams.json`;
      await FileSystem.writeAsStringAsync(streamsPath, JSON.stringify(params.streams));
    }

    const kind: RecordingKind = manual ? 'manual' : 'fit';
    const entry: RecordingLibraryEntry = present({
      id,
      kind,
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
    });

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

/**
 * The request body a manual entry holds, or null when it cannot be read.
 *
 * Null is not "no body": it is a body the device cannot produce right now, and
 * the caller holds the entry rather than posting an entry it cannot describe.
 */
export async function readRecordingManualBody(
  entry: RecordingLibraryEntry
): Promise<ManualActivityData | null> {
  if (entry.kind !== 'manual' || !entry.streamsPath) return null;
  try {
    const info = await FileSystem.getInfoAsync(entry.streamsPath);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(entry.streamsPath)) as ManualActivityData;
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
    const streams = JSON.parse(data) as RecordingStreams;
    streams.altitude = streams.altitude.map((alt) => alt ?? NaN);
    return streams;
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

/**
 * The transport failed before intervals.icu was reached.
 *
 * The ride keeps its attempt count: a request that never arrived says nothing
 * about the ride, and a device out of signal for a week would otherwise spend
 * all five attempts on cold launches and park a ride the server never saw. The
 * attempt is stamped, so the ordinary backoff still applies.
 */
export async function holdRecordingForNetwork(id: string, error: string): Promise<void> {
  library().holdRecordingForNetwork(id, error, Date.now());
  log.log(`Upload held for the network: ${id} (${error})`);
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
export async function holdRecordingsOfOtherAthletes(athleteId: string): Promise<void> {
  library().holdRecordingsOfOtherAthletes(athleteId);
  log.log(`Held any recording not belonging to ${athleteId}`);
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

// ─── Deletion after confirmation or on user request ───────────────────────────

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
    library(true);
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
 * are copied into the recordings dir before insertion; entries become 'pending' (or
 * 'permissionBlocked') with metadata reconstructed from what the queue knew.
 */
export async function migrateLegacyUploadQueue(): Promise<void> {
  try {
    library(true);
    const stored = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
    if (!stored) return;

    const legacy = JSON.parse(stored) as LegacyQueueEntry[];
    await ensureRecordingsDir();

    let complete = true;
    for (const old of legacy) {
      try {
        const engine = library(true);
        if (engine.getRecording(old.id)) continue;
        const fitPath = `${RECORDINGS_DIR}${old.id}.fit`;
        const destination = await FileSystem.getInfoAsync(fitPath);
        if (!destination.exists) {
          const source = await FileSystem.getInfoAsync(old.filePath);
          if (!source.exists) throw new Error('Legacy recording FIT is missing');
          await FileSystem.copyAsync({ from: old.filePath, to: fitPath });
        }

        // The legacy queue held FIT uploads only.
        const kind: RecordingKind = 'fit';
        const uploadStatus: RecordingUploadStatus = old.permissionBlocked
          ? 'permissionBlocked'
          : 'pending';
        const entry: RecordingLibraryEntry = present({
          id: old.id,
          kind,
          fitPath,
          activityType: old.activityType,
          name: old.name,
          startTime: old.createdAt,
          durationSeconds: 0,
          distanceMeters: 0,
          pairedEventId: old.pairedEventId,
          createdAt: old.createdAt,
          uploadStatus,
          retryCount: 0,
          lastError: old.lastError,
        });
        library().addRecording(toEngineEntry(entry));
        await FileSystem.deleteAsync(old.filePath, { idempotent: true });
      } catch (err) {
        complete = false;
        log.warn(`Failed to migrate legacy upload ${old.id}:`, err);
      }
    }

    if (!complete) return;
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
