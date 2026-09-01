import { debug } from '@/shared/debug/debug';
import { uploadActivityFile } from './intervalsUploads';
import { engine } from 'veloqrs';
import {
  recordingFitExists,
  readRecordingFit,
  markRecordingUploading,
  markRecordingUploaded,
  markRecordingUploadFailed,
  markRecordingRejected,
  markRecordingPermissionBlocked,
  discardRecordingFit,
} from '@/features/recording/lib/storage/recordingLibrary';
import { classifyUploadError } from './classifyUploadError';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Upload');

/**
 * Pull the strength sets out of a recorded session's own FIT.
 *
 * intervals.icu keeps the sets in the file it was handed, so nothing comes
 * back down the sync for them. Parsing the local copy is what puts a session
 * recorded in the app on the same footing as one recorded on a watch.
 *
 * Best effort by design: the upload has already succeeded by the time this
 * runs, and a session with no sets on device is worth less than a session the
 * queue thinks failed.
 */
async function importRecordedStrengthSets(
  entry: RecordingLibraryEntry,
  activityId: string | undefined
): Promise<void> {
  if (entry.activityType !== 'WeightTraining') return;

  // The sets key on the activity the server created. Without that id there is
  // nothing to attach them to, and the next sync will carry them anyway.
  if (!activityId) {
    log.warn(`No activity id for ${entry.id}, leaving its strength sets to the sync`);
    return;
  }

  try {
    const fit = await readRecordingFit(entry);
    if (!fit) return;

    const inserted = engine.importSetsFromFit(activityId, new Uint8Array(fit));
    log.log(`Imported ${inserted} strength sets from ${entry.id}`);
  } catch (err) {
    log.warn(`Strength set import failed for ${entry.id}: ${String(err)}`);
  }
}

export type UploadRecordingOutcome =
  | 'uploaded'
  | 'permissionBlocked'
  | 'rejected'
  | 'retriable'
  | 'network'
  | 'missing';

export interface UploadRecordingResult {
  outcome: UploadRecordingOutcome;
  /** User-facing detail for rejected/failed uploads. */
  errorDetail?: string;
}

/**
 * Upload a library recording to intervals.icu and apply the matching status
 * transition. The single upload path shared by the review-screen save, the
 * background processor, and the library's manual "upload now".
 *
 * The FIT file on disk is the source of truth until the upload lands, and no
 * failure outcome deletes it. The engine streams it straight off disk, so a long
 * ride never has to fit in memory to be uploaded. Once intervals.icu has the
 * activity, and once everything that still needed the bytes has read them, the
 * FIT is discarded.
 */
export async function uploadRecording(
  entry: RecordingLibraryEntry
): Promise<UploadRecordingResult> {
  if (!(await recordingFitExists(entry))) {
    log.warn(`FIT file missing for ${entry.id}`);
    await markRecordingRejected(entry.id, 'FIT file missing on device');
    return { outcome: 'missing' };
  }

  await markRecordingUploading(entry.id);
  try {
    log.log(`Uploading ${entry.name}.fit (${entry.id})...`);
    const activityId = await uploadActivityFile(entry.fitPath, `${entry.name}.fit`, {
      name: entry.name,
      pairedEventId: entry.pairedEventId,
    });
    await markRecordingUploaded(entry.id, activityId);
    // Reads the same FIT, so the discard below has to wait for it.
    await importRecordedStrengthSets(entry, activityId);
    // A finished upload stays finished even if the file cannot be removed.
    await discardRecordingFit(entry.id).catch((err) => {
      log.warn(`Could not discard FIT for ${entry.id}: ${String(err)}`);
    });
    return { outcome: 'uploaded' };
  } catch (uploadErr) {
    const err = classifyUploadError(uploadErr);
    log.warn(
      `Upload failed (${err.type}, status=${err.httpStatus ?? 'n/a'}): ${err.apiDetail ?? err.errMsg}`
    );

    if (err.type === 'http403') {
      await markRecordingPermissionBlocked(entry.id);
      return { outcome: 'permissionBlocked' };
    }

    if (err.type === 'network') {
      await markRecordingUploadFailed(entry.id, err.errMsg);
      return { outcome: 'network', errorDetail: err.errMsg };
    }

    const detail = err.apiDetail ?? err.errMsg;
    const retriable =
      err.httpStatus == null ||
      err.httpStatus >= 500 ||
      err.httpStatus === 408 ||
      err.httpStatus === 429;
    if (retriable) {
      await markRecordingUploadFailed(entry.id, detail);
      return { outcome: 'retriable', errorDetail: detail };
    }

    // Client-side rejection (4xx) - retrying the same bytes cannot succeed;
    // park for the user, keep the file.
    await markRecordingRejected(entry.id, detail);
    return { outcome: 'rejected', errorDetail: detail };
  }
}
