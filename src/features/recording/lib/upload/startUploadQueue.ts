import { debug } from '@/shared/debug/debug';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  adoptAsyncStorageIndex,
  migrateLegacyUploadQueue,
  onUploadPermissionRefused,
  wakeUploadSchedule,
} from '@/features/recording/lib/storage/recordingLibrary';
import { replayProvisionalWrites } from '@/features/recording/lib/storage/provisionalActivity';

const log = debug.create('UploadQueue');

/**
 * Held for the life of the process: the engine client keeps its listeners
 * across a reopen, so a second subscription would hear every refusal twice.
 */
let hearingRefusals = false;

function hearRefusals(): void {
  if (hearingRefusals) return;
  onUploadPermissionRefused(() => {
    useUploadPermissionStore.getState().setHasWritePermission(false);
  });
  hearingRefusals = true;
}

/**
 * What the upload queue owes each engine open, run by launch once the library
 * is known to be the signed-in athlete's.
 *
 * The engine's schedule uploads every due ride and sweeps the landed ones
 * itself, so this only starts it. Before the wake, the refusal announcement is
 * heard, so one from the first drain is not missed: every other ride would
 * meet it too, until the athlete grants write access. The adoption reads
 * AsyncStorage, which only this side can, and writes the engine row of any
 * ride whose save never got one. A write that fails again waits for the next
 * open, and nothing here reaches launch as a throw.
 */
export async function startUploadQueue(): Promise<void> {
  try {
    hearRefusals();
    wakeUploadSchedule();
  } catch (err: unknown) {
    log.warn(`Could not start the upload schedule: ${String(err)}`);
  }
  try {
    await migrateLegacyUploadQueue();
    await adoptAsyncStorageIndex();
    await replayProvisionalWrites();
  } catch (err: unknown) {
    log.warn(`Replaying missed engine rows failed: ${String(err)}`);
  }
}
