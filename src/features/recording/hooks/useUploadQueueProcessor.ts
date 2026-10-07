import { useEffect } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  migrateLegacyUploadQueue,
  adoptAsyncStorageIndex,
  holdRecordingsOfOtherAthletes,
  onUploadPermissionRefused,
  wakeUploadSchedule,
} from '@/features/recording/lib/storage/recordingLibrary';
import {
  reconcileProvisionalUploads,
  replayProvisionalWrites,
} from '@/features/recording/lib/storage/provisionalActivity';
import { sendOwedRpe } from '@/features/recording/lib/upload/owedRpe';
import { confirmAndDeleteUploaded } from '@/features/recording/lib/upload/confirmUploads';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineStatus } from '@/features/routes';
import { debug } from '@/shared/debug/debug';

const log = debug.create('UploadQueue');

/**
 * Starts the engine's upload schedule, which drains pending library uploads
 * itself: it waits for the connection and for each entry's backoff, in the
 * foreground or not. Write permission being granted is the one trigger that
 * stays here, since it is the athlete's action, and it wakes the schedule.
 * Must be rendered after auth is established.
 */
export function useUploadQueueProcessor() {
  const engine = useEngineReady();
  const engineReady = engine?.ready === true;
  const readyNonce = useEngineStatus((s) => s.readyNonce);
  const athleteId = useAuthStore((state) => state.athleteId);
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);

  // Adopt the old upload queue into the table, then the old AsyncStorage index,
  // then write the engine row of any ride whose save never got one. Once per
  // engine open: a write that fails again waits for the next one.
  useEffect(() => {
    if (!engine?.ready) return;
    void migrateLegacyUploadQueue()
      .then(adoptAsyncStorageIndex)
      .then(replayProvisionalWrites)
      .catch((err: unknown) => {
        log.warn(`Replaying missed engine rows failed: ${String(err)}`);
      });
  }, [engine, readyNonce]);

  // A forced sign-out holds the queue rather than demoting it, so whoever
  // signs in next can meet rides that are not theirs. Theirs keep their place;
  // everything else stops auto-uploading before a single one is sent.
  useEffect(() => {
    if (!athleteId) return;
    holdRecordingsOfOtherAthletes(athleteId).catch((err: unknown) => {
      log.warn(`Could not hold another athlete's recordings: ${String(err)}`);
    });
  }, [athleteId]);

  // An upload whose engine write missed leaves a row the sync will duplicate.
  // An effort the upload could not set is sent next, since the row is its only
  // record. The confirmation runs behind both, over the same entries: an upload
  // is not finished until the activity has been read back off intervals.icu,
  // and only then does the recording go.
  useEffect(() => {
    reconcileProvisionalUploads()
      .then(() => sendOwedRpe())
      .then(() => confirmAndDeleteUploaded())
      .catch((err: unknown) => {
        log.warn(`Reconcile pass failed: ${String(err)}`);
      });
  }, []);

  // The engine decides when a ride is due and uploads it. Opening the
  // subscription before the wake means a refusal from the first drain is heard:
  // every other ride would meet it too, until the athlete grants write access.
  useEffect(() => {
    if (!engineReady) return undefined;
    const off = onUploadPermissionRefused(() => {
      useUploadPermissionStore.getState().setHasWritePermission(false);
    });
    wakeUploadSchedule();
    return off;
  }, [engineReady, readyNonce]);

  // A write upgrade makes the athlete's blocked rides pending again, which
  // the schedule has to be told about.
  useEffect(() => {
    if (!engineReady || needsUpgrade) return;
    wakeUploadSchedule();
  }, [engineReady, readyNonce, needsUpgrade]);
}
