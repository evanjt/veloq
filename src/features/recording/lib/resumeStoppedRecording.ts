import {
  buildRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { resetAutoPause } from '@/features/recording/lib/manualPause';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { replaceTo } from '@/shared/app/navigation';

/**
 * Take a stopped ride back from review to its live screen, paused.
 *
 * The store transition restarts the location watch, which follows the status.
 * The backup is rewritten after it so an app kill restores a ride that is live
 * again rather than one that is stopped.
 */
export async function resumeStoppedRecording(): Promise<void> {
  const before = useRecordingStore.getState();
  if (before.status !== 'stopped' || before.savedToLibrary || !before.activityType) return;

  resetAutoPause();
  before.reopenStoppedRecording();
  const after = useRecordingStore.getState();
  if (after.status !== 'paused') return;

  replaceTo(`/recording/${after.activityType}`);
  const backup = buildRecordingBackup(after);
  if (backup) await saveRecordingBackup(backup);
}
