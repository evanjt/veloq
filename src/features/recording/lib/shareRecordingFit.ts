import * as Sharing from 'expo-sharing';

import { recordingFitExists } from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

/**
 * Open the share sheet on a recording's FIT file, answering whether the file is
 * still on the device. A cancelled sheet or a platform without one is not a failure.
 */
export async function shareRecordingFit(entry: RecordingLibraryEntry): Promise<boolean> {
  if (entry.kind !== 'fit' || !entry.fitPath) return false;
  let available = false;
  try {
    available = await recordingFitExists(entry);
    if (available && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(entry.fitPath, {
        mimeType: 'application/octet-stream',
        dialogTitle: `${entry.name}.fit`,
      });
    }
  } catch {
    // Cancelled, or no share sheet on this platform.
  }
  return available;
}
