import { FfiUploadOutcome, type FfiUploadResult } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { writeProvisionalActivity } from '@/features/recording/lib/storage/provisionalActivity';
import { finishStrengthRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import type { RecordingLibraryEntry } from '@/types';

/** Why a finished session stays on the device instead of going to intervals.icu. */
type KeptReason = 'sourceCannotUpload' | 'noUploadScope' | 'autoUploadOff';

type StrengthFinishOutcome =
  /** No set was done: nothing was written and the live session is as it was. */
  | { kind: 'noSets' }
  | {
      kind: 'saved';
      entry: RecordingLibraryEntry;
      /** Set when the row was kept on the device, and then no upload was tried. */
      kept: KeptReason | null;
      /** The upload's answer, null when none was tried. */
      upload: FfiUploadResult | null;
    };

function keptReason(): KeptReason | null {
  const { authMethod, isDemoMode, athleteId } = useAuthStore.getState();
  if (sourceFor({ authMethod, isDemoMode, athleteId })?.can.uploads === false) {
    return 'sourceCannotUpload';
  }
  if (useUploadPermissionStore.getState().recordingWithoutScope) return 'noUploadScope';
  if (!useRecordingPreferences.getState().autoUploadEnabled) return 'autoUploadOff';
  return null;
}

/**
 * Finish the live strength session through the engine and send what it wrote.
 * The file uploaded is the FIT the engine wrote from the done sets, in the
 * athlete's own weight unit, and the engine relinks the session to the
 * activity once the upload lands. A session with no done set is not finished,
 * so the caller can fall back to the manual form.
 */
export async function finishStrengthSession(input: {
  name: string;
  rpe: number | null;
  athleteId: string;
}): Promise<StrengthFinishOutcome> {
  const kept = keptReason();
  const entry = finishStrengthRecording({
    name: input.name,
    rpe: input.rpe ?? undefined,
    athleteId: input.athleteId,
    keepOnDevice: kept !== null,
  });
  if (!entry) return { kind: 'noSets' };
  // The feed, the week and the heatmap read the engine's row, which the finish does not write.
  await writeProvisionalActivity(entry);
  if (kept) return { kind: 'saved', entry, kept, upload: null };
  return { kind: 'saved', entry, kept: null, upload: await uploadRecordingNow(entry.id) };
}

/** The translation keys a saved session's notice takes. */
type SavedNoticeKey =
  | 'recording.savedLocally'
  | 'recording.savedLocallyNoScope'
  | 'recording.savedLocallyNoUpload'
  | 'recording.savedLocallyNoUploadGarmin'
  | 'recording.savedQueued'
  | 'recording.savedQueuedAuth'
  | 'recording.uploadRejected'
  | 'recording.uploadMissing';

/**
 * What to tell the athlete about a session that is saved, as a translation key, or null when it
 * uploaded and the feed shows it. Every other answer leaves the row in the library, which is
 * where it is retried or sent from.
 */
export function savedNoticeKey(
  outcome: Extract<StrengthFinishOutcome, { kind: 'saved' }>
): SavedNoticeKey | null {
  if (outcome.kept === 'sourceCannotUpload') {
    const { authMethod, isDemoMode, athleteId } = useAuthStore.getState();
    return sourceFor({ authMethod, isDemoMode, athleteId })?.id === 'garmin'
      ? 'recording.savedLocallyNoUploadGarmin'
      : 'recording.savedLocallyNoUpload';
  }
  if (outcome.kept === 'noUploadScope') return 'recording.savedLocallyNoScope';
  if (outcome.kept === 'autoUploadOff') return 'recording.savedLocally';
  switch (outcome.upload?.outcome) {
    case FfiUploadOutcome.Uploaded:
      return null;
    case FfiUploadOutcome.PermissionBlocked:
      return 'recording.savedLocallyNoScope';
    case FfiUploadOutcome.Rejected:
      return 'recording.uploadRejected';
    case FfiUploadOutcome.Missing:
      return 'recording.uploadMissing';
    case FfiUploadOutcome.AuthExpired:
    case FfiUploadOutcome.OtherAthlete:
      return 'recording.savedQueuedAuth';
    default:
      return 'recording.savedQueued';
  }
}
