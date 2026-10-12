import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { returnTo } from '@/shared/app/navigation';
import * as haptics from '@/shared/ui/haptics';

/**
 * The accept of the review screen's discard confirmation: one medium impact,
 * then the ride leaves the store, its backup is deleted and the app goes home,
 * popping the live screen beneath the review with it.
 *
 * `startTime` is the ride the athlete confirmed. An accept that lands after
 * that ride has gone, or another has taken its place, does nothing.
 */
export function discardReviewedRecording(startTime: number | null): void {
  const state = useRecordingStore.getState();
  if (state.status === 'idle' || state.startTime !== startTime) return;

  haptics.medium();
  state.reset();
  void clearRecordingBackup();
  returnTo('/');
}
