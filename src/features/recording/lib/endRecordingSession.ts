import {
  buildRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';
import { debug } from '@/shared/debug/debug';

const log = debug.create('RecordingSession');

/**
 * End the ride: stop the store, persist the stopped session, then go to review.
 *
 * All three, together, are what "stop" means. The notification's STOP button
 * used to do only the first, so a rider who stopped from the notification had a
 * session that was over, never written to the backup an app kill restores from,
 * and reachable only by finding the review screen themselves. The screen's own
 * button did all three. Two implementations of one action is what let them
 * differ, so there is one now and both surfaces call it.
 *
 * The backup is built AFTER the transition, so it carries `stopped` and the
 * closed pause intervals rather than the running state.
 *
 * Lives in its own module rather than in `recordingSession`, which imports the
 * notification that calls this.
 */
export async function endRecordingSession(): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.status !== 'recording' && store.status !== 'paused') return;

  store.stopRecording();

  const backup = buildRecordingBackup(useRecordingStore.getState());
  if (backup) await saveRecordingBackup(backup);

  // The backup is written first and the navigation cannot undo it. A press on
  // the notification arrives through a broadcast receiver, which can run with
  // no screen mounted and no router to push onto, and losing the ride because
  // the route failed would be the same defect in a new place. A stop that
  // persists and does not navigate leaves the next foreground to land on the
  // review screen; a stop that navigates and does not persist loses the ride.
  try {
    navigateTo('/recording/review');
  } catch (error) {
    log.warn('stopped and saved, but could not open review', error);
  }
}
