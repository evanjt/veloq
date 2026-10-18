/**
 * The intervals.icu write surface.
 *
 * Rust owns the transport, the rate governor, retry, the 401 classification,
 * the multipart body and the whole upload of a recording, which it runs on its
 * own schedule and on the athlete's word alike, the effort and the read-back
 * that follow it included. What is left here is the seam above it: demo mode,
 * which has no upstream account and acknowledges a write locally.
 */

import { UploadOutcome, recordings, type UploadResult } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import {
  recordingInstall,
  transitionRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
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
 * Demo mode has no account to send to, so the ride is marked uploaded under a
 * local id and nothing leaves the device.
 */
export async function uploadRecordingNow(id: string): Promise<UploadResult> {
  if (staysOnDevice()) {
    const answer = await transitionRecording(id, {
      kind: 'uploaded',
      install: recordingInstall(),
      intervalsActivityId: `demo-${Date.now()}`,
    });
    return { outcome: answer.applied ? UploadOutcome.Uploaded : UploadOutcome.NotStarted };
  }
  return recordings.uploadRecording(id, true, DOCUMENTS_ROOT);
}
