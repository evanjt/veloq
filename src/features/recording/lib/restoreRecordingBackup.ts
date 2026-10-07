import { useRecordingStore, streamTotals } from '../stores/RecordingStore';
import { useRecordingLiveStore } from '../stores/RecordingLiveStore';
import { clearRecordingBackup, loadRecordingBackup } from './storage/recordingBackup';
import { holdsRecordingStartingIn } from './storage/recordingLibrary';
import { sessionReturnRoute } from './sessionReturnRoute';
import { readWorkoutFollow } from './planFollow';
import type { RecordingBackup } from '@/types';
import { useAuthStore } from '@/shared/app/AuthStore';

/**
 * Restore the whole ride in one `setState`, so the session listener's first
 * backup is the ride and never an empty one. The athlete's Resume reopens a
 * live ride paused, with the gap since the last save credited as paused time.
 * A ride auto-pause paused stays auto-paused on every path, so it resumes
 * when the rider sets off; one paused by hand, or saved recording, comes back
 * paused by hand. A headless location batch keeps a recording ride recording, because the
 * rider was moving and the batch's fixes carry their own timestamps, and
 * reopens a paused ride's pause at the last save.
 */
export function restoreRecordingBackup(
  backup: RecordingBackup,
  { headless = false }: { headless?: boolean } = {}
): string | null {
  const now = Date.now();
  const stopped = backup.status === 'stopped';
  const live = headless && !stopped;
  const status = stopped ? 'stopped' : live ? backup.status : 'paused';
  let pause: Partial<ReturnType<typeof useRecordingStore.getState>>;
  if (stopped) {
    pause = {
      pausedDuration: backup.pausedDuration,
      pauseIntervals: backup.pauseIntervals ?? [],
      _pauseStart: null,
    };
  } else if (live) {
    pause = {
      pausedDuration: backup.pausedDuration,
      pauseIntervals: backup.pauseIntervals ?? [],
      _pauseStart: backup.status === 'paused' ? backup.savedAt : null,
    };
  } else {
    pause = {
      pausedDuration: backup.pausedDuration + Math.max(0, now - backup.savedAt),
      pauseIntervals: [
        ...(backup.pauseIntervals ?? []),
        {
          start: (backup.savedAt - backup.startTime) / 1000,
          end: (Math.max(now, backup.savedAt) - backup.startTime) / 1000,
        },
      ],
      _pauseStart: now,
    };
  }
  // Before the store, whose status change starts the session that reads it.
  useRecordingLiveStore
    .getState()
    .setAutoPaused(!stopped && backup.status === 'paused' && backup.autoPaused === true);
  useRecordingStore.setState({
    activityType: backup.activityType,
    athleteId: backup.athleteId ?? null,
    mode: backup.mode,
    pairedEventId: backup.pairedEventId ?? null,
    // The plan comes back as it was frozen, never re-read from a calendar that
    // may have changed since, and the gap credited as paused keeps its step.
    workout: readWorkoutFollow(backup.workout),
    savedToLibrary: false,
    startTime: backup.startTime,
    stopTime: stopped ? (backup.stopTime ?? backup.savedAt) : null,
    ...pause,
    streams: backup.streams,
    totals: streamTotals(backup.streams),
    laps: backup.laps,
    status,
    latestSensor: { heartrate: null, power: null, cadence: null },
    rawSpeed: null,
    _lastRawFix: null,
  });
  return sessionReturnRoute(useRecordingStore.getState());
}

/**
 * Whether the library already holds this stopped ride, so that reopening it
 * would save it a second time. The device records one ride at a time, so a
 * recorded entry starting inside the ride is that ride, whoever it is stamped
 * with: a trimmed save starts after the ride did. A library that cannot be read
 * holds nothing, and the backup is kept.
 */
export function libraryHoldsRide(backup: RecordingBackup): boolean {
  if (backup.status !== 'stopped') return false;
  try {
    return holdsRecordingStartingIn(backup.startTime, backup.stopTime ?? backup.savedAt);
  } catch {
    return false;
  }
}

/**
 * A backup whose ride the library holds outlived its save, and is deleted
 * rather than reopened. True when it was.
 */
export async function settleSavedBackup(backup: RecordingBackup): Promise<boolean> {
  if (!libraryHoldsRide(backup)) return false;
  await clearRecordingBackup(backup.athleteId ?? null, backup);
  return true;
}

/**
 * The athlete's Resume. The load is async, so a session started meanwhile
 * owns the store and the backup file, and restoring over it would replace
 * that ride. Null when there is nothing to resume.
 */
export async function resumeRecordingBackup(): Promise<string | null> {
  const backup = await loadRecordingBackup();
  if (!backup) return null;
  if (backup.athleteId !== (useAuthStore.getState().athleteId ?? undefined)) return null;
  if (await settleSavedBackup(backup)) return null;
  if (backup.athleteId !== (useAuthStore.getState().athleteId ?? undefined)) return null;
  if (useRecordingStore.getState().status !== 'idle') return null;
  return restoreRecordingBackup(backup);
}
