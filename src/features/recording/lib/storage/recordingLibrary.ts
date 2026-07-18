import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { debug } from '@/shared/debug/debug';
import type {
  ActivityType,
  RecordingLibraryEntry,
  RecordingStreams,
  RecordingUploadStatus,
} from '@/types';

const log = debug.create('RecordingLibrary');

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;
const LIBRARY_KEY = 'veloq-recording-library';
const LEGACY_QUEUE_KEY = 'veloq-upload-queue';
const LEGACY_UPLOADS_DIR = `${FileSystem.documentDirectory}pending_uploads/`;

/** Automatic retries before an entry parks as 'failed' (manual retry only). Files are never deleted. */
const MAX_AUTO_RETRIES = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

// ─── Locking ──────────────────────────────────────────────────────────────────
// Serialize every index access through one promise chain. The index is a
// load-modify-save over a single AsyncStorage key, so concurrent callers (the
// upload processor draining while a freshly-saved recording is added) would
// otherwise read the same snapshot and the later write would clobber the
// earlier one — silently dropping a recording that has no server backstop.
let libraryLock: Promise<unknown> = Promise.resolve();
function withLibraryLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = libraryLock.then(fn, fn);
  libraryLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureRecordingsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    log.log('Created recordings directory');
  }
}

async function loadIndex(): Promise<RecordingLibraryEntry[]> {
  try {
    const stored = await AsyncStorage.getItem(LIBRARY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as RecordingLibraryEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveIndex(entries: RecordingLibraryEntry[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
}

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

/** Whether a pending entry is eligible for an automatic retry right now. */
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
 * detail view) plus an index entry. This is the durable copy — upload is an
 * optional step over it and nothing here is ever deleted by retry logic.
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
    };

    await withLibraryLock(async () => {
      const entries = await loadIndex();
      entries.push(entry);
      await saveIndex(entries);
    });
    log.log(`Saved recording ${id} (${params.name}, ${params.uploadStatus})`);
    return entry;
  } catch (error) {
    log.error('Failed to save recording:', error);
    return null;
  }
}

/** All recordings, newest first. */
export function listRecordings(): Promise<RecordingLibraryEntry[]> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  });
}

export function getRecording(id: string): Promise<RecordingLibraryEntry | null> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    return entries.find((e) => e.id === id) ?? null;
  });
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

async function patchEntry(
  id: string,
  patch: Partial<RecordingLibraryEntry>
): Promise<RecordingLibraryEntry | null> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    entries[idx] = { ...entries[idx], ...patch };
    await saveIndex(entries);
    return entries[idx];
  });
}

export async function markRecordingUploading(id: string): Promise<void> {
  await patchEntry(id, { uploadStatus: 'uploading' });
}

export async function markRecordingUploaded(id: string, intervalsActivityId?: string) {
  await patchEntry(id, {
    uploadStatus: 'uploaded',
    intervalsActivityId,
    lastError: undefined,
  });
  log.log(`Recording uploaded: ${id}`);
}

/**
 * Record a retriable upload failure. The entry stays 'pending' until automatic
 * retries are exhausted, then parks as 'failed' for manual retry. The FIT file
 * is always kept.
 */
export async function markRecordingUploadFailed(id: string, error: string): Promise<void> {
  await withLibraryLock(async () => {
    const entries = await loadIndex();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const retryCount = entries[idx].retryCount + 1;
    entries[idx] = {
      ...entries[idx],
      retryCount,
      lastAttemptAt: Date.now(),
      lastError: error,
      uploadStatus: retryCount >= MAX_AUTO_RETRIES ? 'failed' : 'pending',
    };
    await saveIndex(entries);
    log.log(`Upload failed for ${id} (retry ${retryCount}/${MAX_AUTO_RETRIES}): ${error}`);
  });
}

/** A server-side rejection that automatic retries cannot fix. */
export async function markRecordingRejected(id: string, error: string): Promise<void> {
  await patchEntry(id, { uploadStatus: 'failed', lastError: error, lastAttemptAt: Date.now() });
  log.warn(`Upload rejected for ${id}: ${error}`);
}

export async function markRecordingPermissionBlocked(id: string): Promise<void> {
  await patchEntry(id, { uploadStatus: 'permissionBlocked', lastAttemptAt: Date.now() });
}

/** Manual retry (or post-upgrade requeue): back to 'pending' with a clean slate. */
export async function requeueRecording(id: string): Promise<void> {
  await patchEntry(id, {
    uploadStatus: 'pending',
    retryCount: 0,
    lastAttemptAt: undefined,
    lastError: undefined,
  });
}

/** After an OAuth write upgrade, everything permission-blocked becomes uploadable. */
export function clearPermissionBlocked(): Promise<void> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    const updated = entries.map((e) =>
      e.uploadStatus === 'permissionBlocked'
        ? { ...e, uploadStatus: 'pending' as const, retryCount: 0, lastAttemptAt: undefined }
        : e
    );
    await saveIndex(updated);
    log.log('Cleared permission-blocked recordings');
  });
}

/**
 * On logout: keep every recording on device, but stop auto-uploading so
 * nothing lands in a different account after the next login.
 */
export function demotePendingToLocalOnly(): Promise<void> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    const updated = entries.map((e) =>
      e.uploadStatus === 'pending' ||
      e.uploadStatus === 'uploading' ||
      e.uploadStatus === 'permissionBlocked'
        ? { ...e, uploadStatus: 'localOnly' as const }
        : e
    );
    await saveIndex(updated);
    log.log('Demoted pending uploads to local-only');
  });
}

/** Next entry eligible for automatic upload, respecting exponential backoff. */
export function nextPendingUpload(now = Date.now()): Promise<RecordingLibraryEntry | null> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    return entries.find((e) => isRetryEligible(e, now)) ?? null;
  });
}

// ─── Deletion (user-initiated only) ──────────────────────────────────────────

export function deleteRecording(id: string): Promise<void> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    const entry = entries.find((e) => e.id === id);
    await saveIndex(entries.filter((e) => e.id !== id));
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
  });
}

// ─── Counts ───────────────────────────────────────────────────────────────────

/** Recordings not yet on intervals.icu (any status except 'uploaded'). */
export function getUnuploadedCount(): Promise<number> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    return entries.filter((e) => e.uploadStatus !== 'uploaded').length;
  });
}

export function getPermissionBlockedCount(): Promise<number> {
  return withLibraryLock(async () => {
    const entries = await loadIndex();
    return entries.filter((e) => e.uploadStatus === 'permissionBlocked').length;
  });
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

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
        await withLibraryLock(async () => {
          const entries = await loadIndex();
          if (!entries.some((e) => e.id === entry.id)) {
            entries.push(entry);
            await saveIndex(entries);
          }
        });
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
