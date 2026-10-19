/**
 * The intervals.icu write surface.
 *
 * Rust owns the transport, the rate governor, retry, the 401 classification,
 * the multipart body and the whole upload of a recording, which it runs on its
 * own schedule and on the athlete's word alike, the effort and the read-back
 * that follow it included. What is left here is the seam above it: a source
 * that cannot upload, which has no upstream account and starts nothing.
 */

import { UploadOutcome, recordings, type UploadResult } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { DOCUMENTS_ROOT } from '@/features/recording/lib/storage/recordingFiles';

function staysOnDevice(): boolean {
  const { authMethod, isDemoMode, athleteId } = useAuthStore.getState();
  return sourceFor({ authMethod, isDemoMode, athleteId })?.can.uploads === false;
}

/**
 * Upload one recording now, for the review save and Upload now, and answer how
 * it ended. The engine runs the same sequence its schedule runs for a due ride,
 * with a parked ride requeued first because the athlete asked for it.
 *
 * A source that cannot upload has no account to send to, so nothing starts and
 * the ride keeps its status: marking it uploaded would claim a copy that exists
 * nowhere but this device.
 */
export async function uploadRecordingNow(id: string): Promise<UploadResult> {
  if (staysOnDevice()) return { outcome: UploadOutcome.NotStarted };
  return recordings.uploadRecording(id, true, DOCUMENTS_ROOT);
}
