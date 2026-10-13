import type { TFunction } from 'i18next';

import { recordingFitExists } from '@/features/recording/lib/storage/recordingLibrary';
import { shareExistingFile } from '@/features/settings/light';
import { informShareFailed } from '@/shared/ui/shareFailure';
import type { RecordingLibraryEntry } from '@/types';

/**
 * Send a recording's FIT file where the athlete chooses, answering whether the
 * file is still on the device. A send that fails or a device with no share
 * sheet says so; a sheet closed without a target is not a failure.
 */
export async function shareRecordingFit(
  entry: RecordingLibraryEntry,
  t: TFunction
): Promise<boolean> {
  if (entry.kind !== 'fit' || !entry.fitPath) return false;
  let available = false;
  try {
    available = await recordingFitExists(entry);
  } catch {
    return false;
  }
  if (!available) return false;
  try {
    await shareExistingFile(entry.fitPath, 'application/octet-stream', {
      name: `${entry.name}.fit`,
    });
  } catch (error) {
    informShareFailed(error, t);
  }
  return true;
}
