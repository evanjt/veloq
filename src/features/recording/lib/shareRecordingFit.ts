import { recordingFitExists } from '@/features/recording/lib/storage/recordingLibrary';
import { shareCopyAs, type ShareAnchor } from '@/features/settings/light';
import { formatLocalDate } from '@/shared/format/format';
import type { RecordingLibraryEntry } from '@/types';

/**
 * Send a recording's FIT file where the athlete chooses, answering whether the
 * file is still on the device. The file on disk is named by its storage id, so
 * a copy goes out under the recording's name and local date. Rejects when it
 * could not be shared, so the caller can say so.
 */
export async function shareRecordingFit(
  entry: RecordingLibraryEntry,
  anchor?: ShareAnchor
): Promise<boolean> {
  if (entry.kind !== 'fit' || !entry.fitPath) return false;
  if (!(await recordingFitExists(entry))) return false;
  const name = `${entry.name} ${formatLocalDate(new Date(entry.startTime))}`;
  await shareCopyAs(entry.fitPath, 'fit', name, anchor);
  return true;
}
