/**
 * The step between an accepted upload and deleting the ride off the device.
 *
 * A 200 from the upload says intervals.icu took the bytes. It does not say the
 * activity is there: the server can reject it after the fact, deduplicate it
 * against one already stored, or lose it, and until the activity is read back
 * the device's FIT is the only copy that exists. So the upload no longer
 * deletes anything, and this pass does, once and only once it has seen the
 * activity.
 *
 * The engine's own activities table cannot answer the question. The upload
 * writes a provisional row under the device's key and stamps the intervals id
 * beside it, so the id is present there whether or not the server kept the
 * ride. The confirmation is therefore a read of the server.
 */

import { engine, CallKind, type CallOutcome } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { debug } from '@/shared/debug/debug';
import { deleteRecording, listRecordings } from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Recording');

/** What one entry's confirmation came back as. */
export type ConfirmVerdict = 'present' | 'gone' | 'unknown';

/**
 * Read one activity back. `gone` is the server's own 404 and nothing else: a
 * network failure, a 401 and a 500 are all `unknown`, which keeps the files.
 */
export function verdictFor(outcome: CallOutcome): ConfirmVerdict {
  if (outcome.kind === CallKind.Ok) return 'present';
  if (outcome.status === 404) return 'gone';
  return 'unknown';
}

/**
 * Whether the app can confirm anything at all right now.
 *
 * No credential is not a confirmation. An athlete signed out, or signed out by
 * a session expiry, has nothing to ask the server with, and a pass that ran
 * anyway would read every entry as unknown at best. Demo mode has no upstream
 * account, so its uploads are acknowledged locally and there is nothing to
 * read back.
 */
function canConfirm(): boolean {
  const { isAuthenticated, isDemoMode } = useAuthStore.getState();
  return isAuthenticated && !isDemoMode;
}

/** The entries this pass is about: uploaded, with an id, still on disk. */
function owed(entries: RecordingLibraryEntry[]): RecordingLibraryEntry[] {
  return entries.filter(
    (entry) => entry.uploadStatus === 'uploaded' && Boolean(entry.intervalsActivityId)
  );
}

/**
 * Confirm every uploaded recording against the server and delete the ones that
 * are there, answering how many were deleted.
 *
 * Runs beside `reconcileProvisionalUploads`, over the same entries and for the
 * same reason: both are the work an upload could not finish in the moment.
 */
export async function confirmAndDeleteUploaded(): Promise<number> {
  if (!canConfirm()) return 0;

  let deleted = 0;
  for (const entry of owed(await listRecordings())) {
    // The filter above proves it, TypeScript cannot see through it.
    const intervalsId = entry.intervalsActivityId as string;
    let verdict: ConfirmVerdict;
    try {
      verdict = verdictFor(await engine.confirmActivityUploaded(intervalsId));
    } catch (err: unknown) {
      log.warn(`Could not confirm ${entry.id}: ${String(err)}`);
      continue;
    }

    if (verdict === 'present') {
      await deleteRecording(entry.id);
      deleted += 1;
      log.log(`Confirmed ${intervalsId} on intervals.icu, deleted recording ${entry.id}`);
      continue;
    }
    if (verdict === 'gone') {
      // The ride is on the device and nowhere else. Say so loudly and keep it:
      // the athlete still has the FIT to upload again.
      log.warn(`Upload ${intervalsId} is not on intervals.icu, keeping recording ${entry.id}`);
    }
  }
  return deleted;
}
