import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { returnTo } from '@/shared/app/navigation';

/**
 * The accept of the review screen's discard confirmation: the ride leaves the
 * store, its backup is deleted and the app goes home, popping the live screen
 * beneath the review with it. The confirm has already felt the accept.
 *
 * `startTime` is the ride the athlete confirmed. An accept that lands after
 * that ride has gone, or another has taken its place, does nothing. Returns
 * whether the ride was discarded, so the screen knows it is on its way home.
 */
export function discardReviewedRecording(startTime: number | null): boolean {
  const state = useRecordingStore.getState();
  if (state.status === 'idle' || state.startTime !== startTime) return false;

  state.reset();
  void clearRecordingBackup();
  returnTo('/');
  return true;
}
