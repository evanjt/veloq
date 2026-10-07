import { debug } from '@/shared/debug/debug';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import {
  listRecordings,
  markRecordingRpeSent,
} from '@/features/recording/lib/storage/recordingLibrary';
import { updateActivityRpe } from './intervalsUploads';

const log = debug.create('Upload');

/**
 * Send every effort an upload could not, and answer how many went.
 *
 * The upload takes no effort field, so it goes up as a second request, and a
 * failure leaves the ride owing it. This retries that request alone: the upload
 * already landed, and sending the file again would make a second activity. A
 * ride stamped with another athlete is left for them, since the request goes
 * under the credentials signed in.
 */
export async function sendOwedRpe(): Promise<number> {
  const signedIn = getStoredCredentials().athleteId;
  const owed = (await listRecordings()).filter(
    (entry) =>
      entry.uploadStatus === 'uploaded' &&
      Boolean(entry.intervalsActivityId) &&
      entry.rpe != null &&
      !entry.rpeSent &&
      Boolean(entry.athleteId) &&
      entry.athleteId === signedIn
  );
  let sent = 0;
  for (const entry of owed) {
    if (!entry.intervalsActivityId || entry.rpe == null) continue;
    try {
      await updateActivityRpe(entry.intervalsActivityId, entry.rpe);
    } catch (err) {
      log.warn(`Could not set the effort of ${entry.id}, it is retried later: ${String(err)}`);
      continue;
    }
    await markRecordingRpeSent(entry.id);
    sent += 1;
  }
  return sent;
}
