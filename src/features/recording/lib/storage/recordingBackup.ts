import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { debug } from '@/shared/debug/debug';
import type { RecordingBackup } from '@/types';
import { replaceFile } from '@/shared/native/replaceFile';
import { useAuthStore } from '@/shared/app/AuthStore';
import { safeJsonParse } from '@/shared/validation/validation';
import { documentFile } from './recordingFiles';

const log = debug.create('RecordingBackup');

const BACKUP_PATH = documentFile('recording_backup.json');
const BACKUP_VERSION = 2;
const OWNERLESS_PENDING_KEY = 'ownerless_recording_backup_pending_athlete';
const OWNERLESS_SETTLED_KEY = 'ownerless_recording_backup_settled';
export const OWNERLESS_RECORDINGS_SETTLED_KEY = 'ownerless_recordings_settled';
const pendingWrites = new Map<string, Promise<void>>();

function queueBackupOperation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  const pending = result.then(
    () => undefined,
    () => undefined
  );
  pendingWrites.set(path, pending);
  void pending.then(() => {
    if (pendingWrites.get(path) === pending) pendingWrites.delete(path);
  });
  return result;
}

function backupPath(athleteId: string | null | undefined): string {
  return athleteId
    ? documentFile(`recording_backup_${encodeURIComponent(athleteId)}.json`)
    : BACKUP_PATH;
}

/**
 * Stored altitude back to one sample per fix, NaN where the fix had none. JSON
 * writes NaN as null, and a file from an older or interrupted writer may carry
 * no altitude at all, which is missing data rather than a reason to drop the
 * ride.
 */
export function decodeStoredAltitude(altitude: unknown, samples: number): number[] {
  if (!Array.isArray(altitude)) return Array.from({ length: samples }, () => NaN);
  return altitude.map((alt) => (typeof alt === 'number' ? alt : NaN));
}

/** The fields every version of the backup carries. */
function hasCommonFields(obj: Record<string, unknown>): boolean {
  if (typeof obj.activityType !== 'string') return false;
  if (typeof obj.mode !== 'string') return false;
  if (typeof obj.startTime !== 'number' || !Number.isFinite(obj.startTime)) return false;
  if (typeof obj.pausedDuration !== 'number') return false;
  if (typeof obj.savedAt !== 'number') return false;
  if (typeof obj.streams !== 'object' || obj.streams === null) return false;
  const streams = obj.streams as Record<string, unknown>;
  if (!Array.isArray(streams.time) || !Array.isArray(streams.latlng)) return false;
  if (!Array.isArray(obj.laps)) return false;
  return true;
}

function isCurrentBackup(obj: Record<string, unknown>): boolean {
  if (obj.version !== BACKUP_VERSION || !hasCommonFields(obj)) return false;
  if (obj.athleteId !== undefined && typeof obj.athleteId !== 'string') return false;
  if (obj.status !== 'recording' && obj.status !== 'paused' && obj.status !== 'stopped')
    return false;
  if (obj.stopTime !== null && typeof obj.stopTime !== 'number') return false;
  if (obj.pauseIntervals !== undefined && !Array.isArray(obj.pauseIntervals)) return false;
  return true;
}

/**
 * Version 1 laps carry moving seconds and no stream indices. The indices are
 * the samples up to the lap's end, which is how version 1 itself sliced them.
 */
function upgradeVersionOneLaps(laps: unknown[], time: number[]): RecordingBackup['laps'] {
  let next = 0;
  return laps.map((raw) => {
    const lap = raw as Omit<
      RecordingBackup['laps'][number],
      'startIndex' | 'endIndex' | 'movingEndTime'
    >;
    const startIndex = next;
    while (next < time.length && (time[next] ?? Infinity) <= lap.endTime) next++;
    return { ...lap, startIndex, endIndex: next - 1, movingEndTime: lap.endTime };
  });
}

/**
 * The one reader of the backup format. Version 1 had no status, stop time,
 * pauses or owner and was only ever resumed paused, so it reads as a paused
 * ride with no owner. Null for anything no build wrote.
 */
function parseBackup(value: unknown): RecordingBackup | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  let backup: RecordingBackup;
  if (isCurrentBackup(obj)) {
    backup = { ...(obj as unknown as RecordingBackup) };
  } else if (obj.version === 1 && hasCommonFields(obj)) {
    const v1 = obj as unknown as RecordingBackup;
    backup = {
      activityType: v1.activityType,
      mode: v1.mode,
      status: 'paused',
      startTime: v1.startTime,
      stopTime: null,
      pausedDuration: v1.pausedDuration,
      pauseIntervals: [],
      streams: v1.streams,
      laps: upgradeVersionOneLaps(v1.laps, v1.streams.time),
      pairedEventId: typeof v1.pairedEventId === 'number' ? v1.pairedEventId : null,
      savedAt: v1.savedAt,
    };
  } else {
    return null;
  }
  backup.streams = {
    ...backup.streams,
    altitude: decodeStoredAltitude(backup.streams.altitude, backup.streams.time.length),
  };
  return backup;
}

/**
 * Build a backup from a live recording-store snapshot. Returns null when the
 * session has no restorable state (idle, or missing type/mode/startTime).
 * An in-progress pause is folded into pausedDuration so restore only needs to
 * credit the savedAt→restore gap.
 */
export function buildRecordingBackup(state: {
  status: string;
  athleteId?: string | null;
  activityType: string | null;
  mode: string | null;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  pauseIntervals?: RecordingBackup['pauseIntervals'];
  streams: RecordingBackup['streams'];
  laps: RecordingBackup['laps'];
  pairedEventId: number | null;
  workout?: RecordingBackup['workout'] | null;
  _pauseStart: number | null;
  /** The pause reason, which lives beside the recording store rather than in it. */
  autoPaused?: boolean;
}): RecordingBackup | null {
  const { status, activityType, mode, startTime } = state;
  if (status !== 'recording' && status !== 'paused' && status !== 'stopped') return null;
  if (!activityType || !mode || !startTime) return null;

  const now = Date.now();
  const pauseStart = status === 'paused' ? state._pauseStart : null;
  const ongoingPause = pauseStart ? now - pauseStart : 0;

  return {
    ...(state.athleteId ? { athleteId: state.athleteId } : {}),
    activityType: activityType as RecordingBackup['activityType'],
    mode: mode as RecordingBackup['mode'],
    status,
    startTime,
    stopTime: state.stopTime,
    pausedDuration: state.pausedDuration + ongoingPause,
    pauseIntervals: pauseStart
      ? [
          ...(state.pauseIntervals ?? []),
          { start: (pauseStart - startTime) / 1000, end: (now - startTime) / 1000 },
        ]
      : (state.pauseIntervals ?? []),
    ...(status === 'paused' && state.autoPaused ? { autoPaused: true } : {}),
    streams: state.streams,
    laps: state.laps,
    pairedEventId: state.pairedEventId,
    ...(state.workout ? { workout: state.workout } : {}),
    savedAt: now,
  };
}

export async function saveRecordingBackup(backup: RecordingBackup): Promise<boolean> {
  const path = backupPath(backup.athleteId);
  return queueBackupOperation(path, async () => {
    try {
      await FileSystem.writeAsStringAsync(
        `${path}.tmp`,
        JSON.stringify({ ...backup, version: BACKUP_VERSION })
      );
      await replaceFile(`${path}.tmp`, path);
      log.log('Saved recording backup');
      return true;
    } catch (error) {
      log.error('Failed to save recording backup:', error);
      return false;
    }
  });
}

async function clearTemporaryBackup(path: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(`${path}.tmp`, { idempotent: true });
  } catch {
    log.warn('Failed to remove temporary recording backup');
  }
}

export async function loadRecordingBackup(): Promise<RecordingBackup | null> {
  const path = backupPath(useAuthStore.getState().athleteId);
  return queueBackupOperation(path, async () => {
    await clearTemporaryBackup(path);
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;

      const data = await FileSystem.readAsStringAsync(path);
      const parsed = parseBackup(JSON.parse(data));
      if (!parsed) {
        log.warn('Invalid or incompatible recording backup, ignoring it');
        return null;
      }
      return parsed;
    } catch {
      log.warn('Failed to load recording backup');
      return null;
    }
  });
}

export async function clearRecordingBackup(
  athleteId = useAuthStore.getState().athleteId,
  expected?: Pick<RecordingBackup, 'athleteId' | 'startTime'> &
    Partial<Pick<RecordingBackup, 'savedAt'>>
): Promise<void> {
  const path = backupPath(athleteId);
  await queueBackupOperation(path, async () => {
    await clearTemporaryBackup(path);
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return;
      if (expected) {
        const current = JSON.parse(await FileSystem.readAsStringAsync(path));
        if (
          current.athleteId !== expected.athleteId ||
          current.startTime !== expected.startTime ||
          (expected.savedAt !== undefined && current.savedAt !== expected.savedAt)
        )
          return;
      }
      await FileSystem.deleteAsync(path, { idempotent: true });
      log.log('Cleared recording backup');
    } catch {
      // Best effort cleanup
    }
  });
}

/**
 * Builds before the athlete stamp wrote one backup with no owner. The ride is
 * the athlete's whose library it was written beside, so the first launch that
 * opens that library hands it to them, before a sign-in can wipe or rename it.
 * It settles once: a library named later is not the one the ride was recorded
 * beside. With no library to name, an unreadable file, or a newer backup of
 * the athlete's own in the way, the old file stays on disk and nobody is
 * offered it. A failed lookup, read or copy is not a settlement: the athlete
 * the library named is recorded as pending and the next launch retries for
 * that athlete, until `settleOwnerlessAdoptions` ends it. The old file is
 * deleted only once its copy reads back.
 */
export async function adoptOwnerlessRecordingBackup(
  libraryAthlete: () => Promise<string | null>
): Promise<void> {
  try {
    if (await AsyncStorage.getItem(OWNERLESS_SETTLED_KEY)) return;
  } catch {
    return;
  }
  try {
    if ((await FileSystem.getInfoAsync(BACKUP_PATH)).exists) {
      const pending = await AsyncStorage.getItem(OWNERLESS_PENDING_KEY);
      const athleteId = pending ?? (await libraryAthlete());
      if (athleteId) {
        if (!pending) await AsyncStorage.setItem(OWNERLESS_PENDING_KEY, athleteId);
        await moveOwnerlessBackup(athleteId);
      }
    }
  } catch (error) {
    log.warn('Ownerless recording backup left where it was, retrying next launch:', error);
    return;
  }
  try {
    await AsyncStorage.setItem(OWNERLESS_SETTLED_KEY, '1');
    await AsyncStorage.removeItem(OWNERLESS_PENDING_KEY);
  } catch {
    // Unsettled, the next launch retries for the athlete recorded as pending
  }
}

/**
 * Ends every one-time adoption of an older build's ownerless data without
 * moving, stamping or deleting any of it. Called before anything names the
 * library for an athlete it was not already named for, so what an earlier
 * athlete left behind stays on disk under no account rather than passing to
 * the athlete the library is named for next.
 *
 * It rejects when either marker could not be written, after trying both: an
 * unwritten marker leaves the next launch free to adopt for whichever library
 * is open then, so the caller must not wipe or rename the library on that.
 */
export async function settleOwnerlessAdoptions(): Promise<void> {
  let failure: unknown;
  for (const key of [OWNERLESS_SETTLED_KEY, OWNERLESS_RECORDINGS_SETTLED_KEY]) {
    try {
      await AsyncStorage.setItem(key, '1');
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

async function moveOwnerlessBackup(athleteId: string): Promise<void> {
  const target = backupPath(athleteId);
  await queueBackupOperation(target, () =>
    queueBackupOperation(BACKUP_PATH, async () => {
      if (!(await FileSystem.getInfoAsync(BACKUP_PATH)).exists) return;
      const ownerless = parseBackup(
        safeJsonParse<unknown>(await FileSystem.readAsStringAsync(BACKUP_PATH), null)
      );
      if (!ownerless || ownerless.athleteId !== undefined) return;
      if ((await FileSystem.getInfoAsync(target)).exists) {
        const current = parseBackup(
          safeJsonParse<unknown>(await FileSystem.readAsStringAsync(target), null)
        );
        // An unreadable file is a copy that was cut short, not a backup in the way.
        if (current) {
          // The same ride means a kill came between the copy and the delete.
          if (current.athleteId === athleteId && current.startTime === ownerless.startTime) {
            await FileSystem.deleteAsync(BACKUP_PATH, { idempotent: true });
          }
          return;
        }
      }
      await FileSystem.writeAsStringAsync(
        `${target}.tmp`,
        JSON.stringify({ ...ownerless, athleteId, version: BACKUP_VERSION })
      );
      await replaceFile(`${target}.tmp`, target);
      const copy = safeJsonParse<Partial<RecordingBackup>>(
        await FileSystem.readAsStringAsync(target),
        {}
      );
      if (copy.athleteId !== athleteId || copy.startTime !== ownerless.startTime) {
        throw new Error('Ownerless recording backup copy did not read back');
      }
      await FileSystem.deleteAsync(BACKUP_PATH, { idempotent: true });
      log.log('Moved an ownerless recording backup to its athlete');
    })
  );
}
