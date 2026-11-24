import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';
import { present } from 'veloqrs/src/delegates/optional';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import { OWNERLESS_RECORDINGS_SETTLED_KEY, adoptRecordingBackup } from './recordingBackup';
import {
  DOCUMENTS_ROOT,
  LEGACY_UPLOADS_DIR,
  RECORDINGS_DIR,
  legacyUploadPath,
  recordingFilePath,
  storedRecordingName,
} from './recordingFiles';
import type {
  ActivityType,
  ManualActivityData,
  RecordingKind,
  RecordingLibraryEntry,
  RecordingUploadStatus,
} from '@/types';
import { toActivityType } from '@/types';
import { activities, recordings } from 'veloqrs';

const log = debug.create('RecordingLibrary');

const LEGACY_QUEUE_KEY = 'veloq-upload-queue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The engine's row shape and the app's differ in one way that matters: the row
 * carries an open `string` status and a `string` activity type, because Rust
 * does not own either vocabulary.
 */
type EngineEntry = ReturnType<typeof recordings.listRecordings>[number];

/**
 * The app's entry as the engine row wants it. An absent average heart rate is
 * an absent field rather than a recorded `null`, an entry with no reconcile or
 * effort flag reads as owing one, and each file is stored by its name relative to the documents
 * directory, which is what survives a move of the app's container.
 */
function toEngineEntry(entry: RecordingLibraryEntry): EngineEntry {
  const { avgHeartrate, streamsPath, ...rest } = entry;
  return {
    ...rest,
    fitPath: storedRecordingName(entry.fitPath),
    ...(streamsPath !== undefined && { streamsPath: storedRecordingName(streamsPath) }),
    ...(avgHeartrate != null && { avgHeartrate }),
    engineReconciled: entry.engineReconciled ?? false,
    rpeSent: entry.rpeSent ?? false,
  };
}

function toLibraryEntry(row: EngineEntry): RecordingLibraryEntry {
  const { streamsPath, ...rest } = row;
  return {
    ...rest,
    fitPath: recordingFilePath(row.fitPath),
    ...(streamsPath != null && { streamsPath: recordingFilePath(streamsPath) }),
    activityType: toActivityType(row.activityType),
    uploadStatus: row.uploadStatus as RecordingUploadStatus,
    // The column is NOT NULL with a 'fit' default, so anything else is a row
    // this build does not know about and a FIT is the safe reading.
    kind: row.kind === 'manual' ? 'manual' : 'fit',
  };
}

/**
 * Copies what a legacy key holds that no retry can adopt to a sibling key, so
 * the key can be retired without destroying it. The app never reads the
 * archive. It is written before the source key goes: a failed write throws and
 * the source stays.
 */
async function archiveUnadoptable(sourceKey: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(
    `${sourceKey}-unadoptable`,
    typeof value === 'string' ? value : JSON.stringify(value)
  );
}

/**
 * The engine, or a throw. The index is the only record of a recording the
 * server does not have yet, so a caller that cannot reach it must hear so
 * rather than read an empty library as "nothing recorded". The throw carries
 * the engine's own not-open tag, so a surface names it as the engine does.
 */
function library(requireReady = false): NonNullable<ReturnType<typeof getEngine>> {
  const engine = getEngine();
  if (!engine || (requireReady && !engine.ready)) {
    throw Object.assign(new Error('Engine not initialised'), { tag: 'NotInitialized' });
  }
  return engine;
}

/** The recordings namespace, behind the same throw as the handle. */
function store(requireReady = false): typeof recordings {
  library(requireReady);
  return recordings;
}

async function ensureRecordingsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    log.log('Created recordings directory');
  }
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

function newRecordingId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FinishStrengthParams {
  name: string;
  /** The effort from 1 to 10, absent when the slider was never moved. */
  rpe?: number | undefined;
  /** Whose session this is, taken when Save was tapped. */
  athleteId: string;
  /** The row waits on the device instead of joining the upload queue. */
  keepOnDevice: boolean;
}

/**
 * Finish the live strength session as a recording. The engine writes the FIT of
 * its done sets and the row in one transaction, so the library holds both or
 * neither. Null when no set was done: nothing was written and the session is
 * still live. Throws when the engine refuses or is not open.
 */
export function finishStrengthRecording(
  params: FinishStrengthParams
): RecordingLibraryEntry | null {
  const signedIn = getStoredCredentials().athleteId;
  const othersSignedIn = !!signedIn && signedIn !== params.athleteId;
  const answer = store(true).finishStrengthRecording({
    recordingId: newRecordingId(),
    name: params.name,
    athleteId: params.athleteId,
    nowSeconds: Date.now() / 1000,
    rpe: params.rpe,
    keepOnDevice: params.keepOnDevice || othersSignedIn,
    filesRoot: DOCUMENTS_ROOT,
  });
  if (answer.kind === 'noSets') return null;
  log.log(`Finished strength session as recording ${answer.entry.id} (${params.name})`);
  return toLibraryEntry(answer.entry);
}

// Keep the FIT and the index until confirmation reads the activity back. The
// track lives in the FIT and the engine's row, so no streams copy is written.
export async function saveRecording(
  params: SaveRecordingParams
): Promise<RecordingLibraryEntry | null> {
  const written: string[] = [];
  try {
    library(true);
    await ensureRecordingsDir();
    const id = newRecordingId();
    // The key is a pure function of the id, so it goes in with the row: an
    // upload that lands before the provisional write finds it and waits.
    const engineActivityId = activities.provisionalActivityId(id) || undefined;
    const manual = params.manualBody !== undefined;

    // A manual entry names no file. The column cannot hold a null, so the empty
    // string is what "no FIT" looks like, and `kind` is what the upload reads.
    let fitPath = '';
    if (params.fitBuffer) {
      fitPath = `${RECORDINGS_DIR}${id}.fit`;
      written.push(fitPath);
      new File(fitPath).write(new Uint8Array(params.fitBuffer));
    }

    let streamsPath: string | undefined;
    if (manual) {
      streamsPath = `${RECORDINGS_DIR}${id}.manual.json`;
      written.push(streamsPath);
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
      engineActivityId,
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

    store().addRecording(toEngineEntry(entry));
    log.log(`Saved recording ${id} (${params.name}, ${entry.uploadStatus})`);
    return entry;
  } catch (error) {
    log.error('Failed to save recording:', error);
    // No row names these files, so nothing else would ever remove them.
    for (const path of written) {
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        // Best effort cleanup
      }
    }
    return null;
  }
}

/** All recordings, newest first. */
export async function listRecordings(): Promise<RecordingLibraryEntry[]> {
  return store().listRecordings().map(toLibraryEntry);
}

/**
 * Whether a recorded ride in the library starts inside this window. Read in
 * place, so a caller can decide before anything else moves.
 */
export function holdsRecordingStartingIn(from: number, to: number): boolean {
  return store()
    .listRecordings()
    .some((row) => row.kind !== 'manual' && row.startTime >= from && row.startTime <= to);
}

/** The recordings the signed-in athlete may see, newest first. */
export async function listVisibleRecordings(): Promise<RecordingLibraryEntry[]> {
  return store()
    .listVisibleRecordings(getStoredCredentials().athleteId ?? undefined)
    .map(toLibraryEntry);
}

/** One recording, null when another athlete holds it. */
export async function getVisibleRecording(id: string): Promise<RecordingLibraryEntry | null> {
  const row = store().getVisibleRecording(id, getStoredCredentials().athleteId ?? undefined);
  return row ? toLibraryEntry(row) : null;
}

export async function getRecording(id: string): Promise<RecordingLibraryEntry | null> {
  const row = store().getRecording(id);
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
 * Remember the engine key the recording was written under. A ride whose upload
 * already landed has the server's id written onto that row and is marked
 * reconciled by the same engine call.
 */
export async function attachEngineActivity(
  id: string,
  engineActivityId: string
): Promise<RecordingLibraryEntry | null> {
  store().attachRecordingEngineActivity(id, engineActivityId);
  return getRecording(id);
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
  store().holdRecordingsOfOtherAthletes(athleteId);
  log.log(`Held any recording not belonging to ${athleteId}`);
}

/**
 * An intervals.icu sign-in adopted a library named for a Garmin account: its
 * rides and any interrupted-ride backup take the new identity, so the library
 * still shows them and the sign-in hold leaves them queued.
 */
export async function adoptRecordingsIdentity(from: string, to: string): Promise<void> {
  store().adoptRecordingsIdentity(from, to);
  await adoptRecordingBackup(from, to);
  log.log('Moved recordings to the adopting athlete');
}

/**
 * After an OAuth write upgrade, the upgrading athlete's permission-blocked
 * recordings become uploadable, and nobody else's: the grant is theirs.
 */
export async function clearPermissionBlocked(athleteId: string): Promise<void> {
  store().clearRecordingPermissionBlocked(athleteId);
  log.log(`Cleared permission-blocked recordings of ${athleteId}`);
}

/**
 * Start the engine's upload schedule and wake it. The engine decides when a
 * pending ride is due and uploads it itself, finding each file under the
 * documents directory handed over here.
 */
export function wakeUploadSchedule(): void {
  store(true).wakeUploadSchedule(DOCUMENTS_ROOT);
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
  const row = store().deleteOwnRecording(id, getStoredCredentials().athleteId ?? undefined);
  if (!row) return;
  const entry = toLibraryEntry(row);
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
  return store().unuploadedVisibleRecordingCount(getStoredCredentials().athleteId ?? undefined);
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

/**
 * Rides the old upload queue left in AsyncStorage reach the table with no
 * athlete, and an unstamped ride is held from every upload. They belong to the
 * athlete whose library they were adopted beside, so the first launch that
 * opens that library stamps them with that athlete, before a sign-in can wipe or
 * rename it. It runs once: a library named later is not the one the rides were
 * recorded beside. With no library to name, nothing is stamped and the pass
 * still settles. The marker waits for the legacy queue key to be gone, so a
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
    const athleteId = await libraryAthlete();
    if (athleteId) store(true).stampOwnerlessRecordings(athleteId);
    if (await AsyncStorage.getItem(LEGACY_QUEUE_KEY)) return;
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
 * Where a FIT the old upload queue held sits now, or null when it is nowhere.
 * The queue stored an absolute path into the data container, which an iOS
 * update can move, so a path that no longer resolves is looked for again by
 * its file name in the live `pending_uploads/`.
 */
async function legacySource(stored: unknown): Promise<string | null> {
  if (typeof stored !== 'string' || !stored) return null;
  for (const path of new Set([stored, legacyUploadPath(stored)])) {
    if ((await FileSystem.getInfoAsync(path)).exists) return path;
  }
  return null;
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

    let legacy: LegacyQueueEntry[];
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) throw new Error('not a list');
      legacy = parsed;
    } catch {
      await archiveUnadoptable(LEGACY_QUEUE_KEY, stored);
      await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
      log.warn('Archived an upload queue that does not parse');
      return;
    }
    await ensureRecordingsDir();

    let complete = true;
    const unadoptable: LegacyQueueEntry[] = [];
    for (const old of legacy) {
      try {
        library(true);
        if (recordings.getRecording(old.id)) continue;
        const fitPath = `${RECORDINGS_DIR}${old.id}.fit`;
        const destination = await FileSystem.getInfoAsync(fitPath);
        const source = await legacySource(old.filePath);
        if (!destination.exists) {
          // No retry can bring the file back, so holding the queue for it
          // would repeat this pass on every engine ready for ever.
          if (!source) {
            log.warn(`Legacy upload ${old.id} has no FIT on disk, skipping it`);
            unadoptable.push(old);
            continue;
          }
          await FileSystem.copyAsync({ from: source, to: fitPath });
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
        store().addRecording(toEngineEntry(entry));
        if (source) await FileSystem.deleteAsync(source, { idempotent: true });
      } catch (err) {
        complete = false;
        log.warn(`Failed to migrate legacy upload ${old.id}:`, err);
      }
    }

    if (!complete) return;
    if (unadoptable.length > 0) await archiveUnadoptable(LEGACY_QUEUE_KEY, unadoptable);
    await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
    try {
      // An entry settled as missing whose file the directory does hold was
      // missed by a probe, not lost, so the directory stays with it.
      const strays = await Promise.all(
        unadoptable.map(async (old) =>
          typeof old.filePath === 'string'
            ? (await FileSystem.getInfoAsync(legacyUploadPath(old.filePath))).exists
            : false
        )
      );
      const dirInfo = await FileSystem.getInfoAsync(LEGACY_UPLOADS_DIR);
      if (strays.some(Boolean)) {
        log.warn('Kept pending_uploads: it holds the FIT of an entry settled as missing');
      } else if (dirInfo.exists) {
        await FileSystem.deleteAsync(LEGACY_UPLOADS_DIR, { idempotent: true });
      }
    } catch {
      // Best effort cleanup
    }
    log.log(`Migrated ${legacy.length} legacy queued upload(s) into the library`);
  } catch (error) {
    log.warn('Legacy upload queue migration failed:', error);
  }
}
