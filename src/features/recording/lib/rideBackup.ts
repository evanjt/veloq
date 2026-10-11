import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { buildRecordingBackup, saveRecordingBackup } from './storage/recordingBackup';
import { BACKUP_INTERVAL_MS } from './constants';

// When the live ride last went to disk, in epoch milliseconds. Background
// batches throttle on it, so a write from the foreground timer counts too. Only
// a write that landed counts: a failed one leaves the next batch free to retry.
let lastWrittenAt: number | null = null;

/**
 * Write the live ride to its crash backup. `at` is the time the write stands
 * for: the wall clock from a timer or a transition, the newest fix from a batch.
 */
export async function writeRideBackup(at: number = Date.now()): Promise<boolean> {
  const backup = buildRecordingBackup({
    ...useRecordingStore.getState(),
    autoPaused: useRecordingLiveStore.getState().autoPaused,
  });
  if (!backup) return false;
  const saved = await saveRecordingBackup(backup);
  if (saved) lastWrittenAt = at;
  return saved;
}

/**
 * Write the ride once an interval has passed since the last write. A
 * backgrounded app gets no timers, so the fixes arriving are the only clock.
 * A fix clock that disagrees with the wall clock by more than an interval
 * writes once and then throttles on fixes alone, rather than waiting it out.
 */
export async function writeRideBackupIfDue(at: number): Promise<boolean> {
  if (lastWrittenAt != null && Math.abs(at - lastWrittenAt) < BACKUP_INTERVAL_MS) return false;
  return writeRideBackup(at);
}

/**
 * Write a stopped ride's backup again with its review edits. A ride the library
 * holds is never written back, or its cleared backup would reopen it for a
 * second save.
 */
export async function writeReviewedRideBackup(): Promise<boolean> {
  const state = useRecordingStore.getState();
  if (state.status !== 'stopped' || state.savedToLibrary) return false;
  const backup = buildRecordingBackup(state);
  if (!backup) return false;
  return saveRecordingBackup(backup);
}
