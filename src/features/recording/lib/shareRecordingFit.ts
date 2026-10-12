import { recordingFitExists } from '@/features/recording/lib/storage/recordingLibrary';
import { shareExistingFile } from '@/features/settings/light';
import type { RecordingLibraryEntry } from '@/types';

/**
 * Send a recording's FIT file where the athlete chooses, answering whether the
 * file is still on the device. A cancelled sheet or a platform without one is
 * not a failure.
 */
export async function shareRecordingFit(entry: RecordingLibraryEntry): Promise<boolean> {
  if (entry.kind !== 'fit' || !entry.fitPath) return false;
  let available = false;
  try {
    available = await recordingFitExists(entry);
    if (available) {
      await shareExistingFile(entry.fitPath, 'application/octet-stream', {
        name: `${entry.name}.fit`,
      });
    }
  } catch {
    // Cancelled, or no share sheet on this platform.
  }
  return available;
}
