import { intervalsApi } from '@/api';
import { debug } from '@/shared/debug/debug';
import {
  readRecordingFit,
  markRecordingUploading,
  markRecordingUploaded,
  markRecordingUploadFailed,
  markRecordingRejected,
  markRecordingPermissionBlocked,
} from '@/features/recording/lib/storage/recordingLibrary';
import { classifyUploadError } from './classifyUploadError';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Upload');

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
 * The FIT file on disk is the source of truth; nothing is deleted here on any
 * outcome.
 */
export async function uploadRecording(
  entry: RecordingLibraryEntry,
  fitBuffer?: ArrayBuffer
): Promise<UploadRecordingResult> {
  const buffer = fitBuffer ?? (await readRecordingFit(entry));
  if (!buffer) {
    log.warn(`FIT file missing for ${entry.id}`);
    await markRecordingRejected(entry.id, 'FIT file missing on device');
    return { outcome: 'missing' };
  }

  await markRecordingUploading(entry.id);
  try {
    log.log(`Uploading ${entry.name}.fit (${entry.id})...`);
    await intervalsApi.uploadActivity(buffer, `${entry.name}.fit`, {
      name: entry.name,
      pairedEventId: entry.pairedEventId,
    });
    await markRecordingUploaded(entry.id);
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

    // Client-side rejection (4xx) — retrying the same bytes cannot succeed;
    // park for the user, keep the file.
    await markRecordingRejected(entry.id, detail);
    return { outcome: 'rejected', errorDetail: detail };
  }
}
