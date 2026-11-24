import { endLocationService } from '@/features/recording/lib/backgroundLocation';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { returnTo } from '@/shared/app/navigation';

/**
 * The accept of the review screen's discard confirmation: the ride leaves the
 * store, its own backup, if it has one, is deleted and the app goes home, popping the live screen
 * beneath the review with it. The confirm has already felt the accept.
 *
 * `startTime` is the ride the athlete confirmed. An accept that lands after
 * that ride has gone, or another has taken its place, does nothing. Returns
 * whether the ride was discarded, so the screen knows it is on its way home.
 */
export function discardReviewedRecording(startTime: number | null): boolean {
  const state = useRecordingStore.getState();
  if (state.status === 'idle' || state.startTime !== startTime) return false;

  // Read before reset() empties the store. A manual entry never writes a
  // backup, and a backup is cleared only when it is this ride's own.
  const { mode, athleteId, startTime: rideStart } = state;
  state.reset();
  void endLocationService();
  if (mode !== 'manual' && rideStart !== null)
    void clearRecordingBackup(athleteId, {
      ...(athleteId ? { athleteId } : {}),
      startTime: rideStart,
    });
  returnTo('/');
  return true;
}
