import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';
import { present } from 'veloqrs/src/delegates/optional';
import type {
  RecordingTransition,
  RecordingTransitionAnswer,
} from 'veloqrs/src/delegates/recordings';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import { OWNERLESS_RECORDINGS_SETTLED_KEY } from './recordingBackup';
import type {
  ActivityType,
  ManualActivityData,
  RecordingKind,
  RecordingLibraryEntry,
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
 * AsyncStorage index carries no reconcile or effort flag, which reads as
 * owing one.
 */
function toEngineEntry(entry: RecordingLibraryEntry): EngineEntry {
  const { avgHeartrate, ...rest } = entry;
  return {
    ...rest,
    ...(avgHeartrate != null && { avgHeartrate }),
    engineReconciled: entry.engineReconciled ?? false,
    rpeSent: entry.rpeSent ?? false,
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
  activityType: ActivityType;
  name: string;
  startTime: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGain?: number | undefined;
  avgHeartrate?: number | null | undefined;
  pairedEventId?: number | undefined;
  /** What the athlete wrote on the review screen. */
  notes?: string | undefined;
  /** The effort from 1 to 10, absent when the slider was never moved. */
  rpe?: number | undefined;
  uploadStatus: Extract<RecordingUploadStatus, 'pending' | 'localOnly'>;
  /**
   * Whose ride this is, taken when Save was tapped. The write can finish after
   * that athlete signed out and another signed in, so it is never read from
   * whoever is signed in at write time.
   */
  athleteId: string;
}

// Keep the FIT and the index until confirmation reads the activity back. The
// track lives in the FIT and the engine's row, so no streams copy is written.
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
    }

    const kind: RecordingKind = manual ? 'manual' : 'fit';
    const signedIn = getStoredCredentials().athleteId;
    const othersSignedIn = !!signedIn && signedIn !== params.athleteId;
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
      notes: params.notes?.trim() ? params.notes : undefined,
      rpe: params.rpe,
      rpeSent: false,
      createdAt: Date.now(),
      // The sign-in hold has already run when another athlete is signed in by
      // the time the write lands, so the row is held here instead.
      uploadStatus: othersSignedIn ? 'localOnly' : params.uploadStatus,
      retryCount: 0,
      // A forced sign-out holds pending entries instead of demoting them, so
      // this is what keeps one athlete's recording out of the next athlete's
      // account.
      athleteId: params.athleteId,
    });

    library().addRecording(toEngineEntry(entry));
    log.log(`Saved recording ${id} (${params.name}, ${entry.uploadStatus})`);
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

/**
 * Whether a recorded ride in the library starts inside this window. Read in
 * place, so a caller can decide before anything else moves.
 */
export function holdsRecordingStartingIn(from: number, to: number): boolean {
  return library()
    .listRecordings()
    .some((row) => row.kind !== 'manual' && row.startTime >= from && row.startTime <= to);
}

/** The recordings the signed-in athlete may see, newest first. */
export async function listVisibleRecordings(): Promise<RecordingLibraryEntry[]> {
  return library()
    .listVisibleRecordings(getStoredCredentials().athleteId ?? undefined)
    .map(toLibraryEntry);
}

/** One recording, null when another athlete holds it. */
export async function getVisibleRecording(id: string): Promise<RecordingLibraryEntry | null> {
  const row = library().getVisibleRecording(id, getStoredCredentials().athleteId ?? undefined);
  return row ? toLibraryEntry(row) : null;
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

/** intervals.icu has the effort the athlete set, so nothing is owed. */
export async function markRecordingRpeSent(id: string): Promise<void> {
  library().markRecordingRpeSent(id);
}

/**
 * The install the engine is open under. An upload outcome carries it back, so
 * one that outlived a restore or a wipe is refused rather than written into
 * another library. A begin answers the install its attempt ran under; work
 * that has no begin reads it before it starts.
 */
export function recordingInstall(): number {
  return library().engineInstall();
}

/**
 * Move one recording's upload by a named transition. The engine keeps the one
 * table of legal moves, so a refusal is an answer, not an error: nothing was
 * written and the caller stops.
 *
 * What an outcome means is logged here: a retriable failure counts an attempt,
 * a held ride keeps its attempts, a rejection parks the ride for the athlete.
 * The FIT file is never deleted by a transition.
 */
export async function transitionRecording(
  id: string,
  transition: RecordingTransition
): Promise<RecordingTransitionAnswer> {
  const answer = library().transitionRecording(id, transition, Date.now());
  if (!answer.applied) {
    log.warn(`Upload move ${transition.kind} refused for ${id}: ${answer.refusal ?? 'unknown'}`);
    return answer;
  }
  switch (transition.kind) {
    case 'uploaded':
      log.log(`Recording uploaded: ${id}`);
      break;
    case 'failed':
      log.log(
        `Upload failed for ${id} (retry ${answer.retryCount}/${MAX_AUTO_RETRIES}): ${transition.error}`
      );
      break;
    case 'heldForNetwork':
      log.log(`Upload held for the network: ${id} (${transition.error})`);
      break;
    case 'heldForAuth':
      log.log(`Holding ${id}: the credential was refused`);
      break;
    case 'rejected':
      log.warn(`Upload rejected for ${id}: ${transition.error}`);
      break;
    default:
      break;
  }
  return answer;
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

/**
 * After an OAuth write upgrade, the upgrading athlete's permission-blocked
 * recordings become uploadable, and nobody else's: the grant is theirs.
 */
export async function clearPermissionBlocked(athleteId: string): Promise<void> {
  library().clearRecordingPermissionBlocked(athleteId);
  log.log(`Cleared permission-blocked recordings of ${athleteId}`);
}

/**
 * Start the engine's upload schedule and wake it. The engine decides when a
 * pending ride is due and uploads it itself.
 */
export function wakeUploadSchedule(): void {
  library(true).wakeUploadSchedule();
}

/** Call `onChange` each time the engine moves a recording's upload. */
export function onRecordingsChanged(onChange: () => void): () => void {
  return library().subscribe('recordingsChanged', onChange);
}

/**
 * Call `onRefused` each time intervals.icu refuses an upload for want of write
 * permission, which every other ride would meet too.
 */
export function onUploadPermissionRefused(onRefused: () => void): () => void {
  return library().subscribe('uploadPermissionRefused', onRefused);
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

// ─── Deletion after confirmation or on user request ───────────────────────────

export async function deleteRecording(id: string): Promise<void> {
  const entry = library().deleteOwnRecording(id, getStoredCredentials().athleteId ?? undefined);
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

/**
 * Recordings not yet on intervals.icu (any status except 'uploaded') that the
 * signed-in athlete may see.
 */
export async function getVisibleUnuploadedCount(): Promise<number> {
  return library().unuploadedVisibleRecordingCount(getStoredCredentials().athleteId ?? undefined);
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

/**
 * Adopt the AsyncStorage index into the table, once.
 *
 * Runs after `migrateLegacyUploadQueue`, which writes directly to the table.
 * Insert-if-absent lets a partial pass retry without duplicating rows.
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
    let complete = true;
    for (const entry of parsed as RecordingLibraryEntry[]) {
      if (!entry?.id || !entry.fitPath) {
        complete = false;
        continue;
      }
      try {
        const engine = library(true);
        if (engine.addRecording(toEngineEntry({ ...entry, kind: entry.kind ?? 'fit' }))) {
          adopted += 1;
        } else if (!engine.getRecording(entry.id)) {
          complete = false;
        }
      } catch (error) {
        complete = false;
        log.warn(`Failed to adopt recording ${entry.id}:`, error);
      }
    }

    if (!complete) return adopted;
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

/**
 * Rides an older build left in AsyncStorage reach the table with no athlete,
 * and an unstamped ride is held from every upload. They belong to the athlete
 * whose library they were adopted beside, so the first launch that opens that
 * library adopts them and names that athlete, before a sign-in can wipe or
 * rename it. It runs once: a library named later is not the one the rides were
 * recorded beside. With no library to name, nothing is stamped and the pass
 * still settles. The marker waits for both legacy keys to be gone, so a
 * partial adoption retries at the next launch.
 */
export async function adoptOwnerlessRecordings(
  libraryAthlete: () => Promise<string | null>
): Promise<void> {
  try {
    if (await AsyncStorage.getItem(OWNERLESS_RECORDINGS_SETTLED_KEY)) return;
  } catch {
    return;
  }
  try {
    await migrateLegacyUploadQueue();
    await adoptAsyncStorageIndex();
    const athleteId = await libraryAthlete();
    if (athleteId) library(true).stampOwnerlessRecordings(athleteId);
    const pending =
      (await AsyncStorage.getItem(LEGACY_QUEUE_KEY)) ??
      (await AsyncStorage.getItem(LEGACY_INDEX_KEY));
    if (pending) return;
    await AsyncStorage.setItem(OWNERLESS_RECORDINGS_SETTLED_KEY, '1');
  } catch (error) {
    log.warn('Ownerless recordings left unstamped:', error);
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
          // No retry can bring the file back, so holding the queue for it
          // would repeat this pass on every engine ready for ever.
          if (!source.exists) {
            log.warn(`Legacy upload ${old.id} has no FIT on disk, skipping it`);
            continue;
          }
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
