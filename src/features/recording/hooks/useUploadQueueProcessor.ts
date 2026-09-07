import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';

import { useNetwork } from '@/shared/app/NetworkContext';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  nextPendingUpload,
  migrateLegacyUploadQueue,
  adoptAsyncStorageIndex,
  holdRecordingsOfOtherAthletes,
} from '@/features/recording/lib/storage/recordingLibrary';
import { reconcileProvisionalUploads } from '@/features/recording/lib/storage/provisionalActivity';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import { debug } from '@/shared/debug/debug';

const log = debug.create('UploadQueue');

/** Low-frequency safety net so backoff-delayed retries fire without an app event. */
const RETRY_TICK_MS = 2 * 60 * 1000;

/**
 * Drains pending library uploads when connectivity is restored, the app comes
 * to the foreground, write permission is granted, or on a slow periodic tick
 * (exponential backoff gates each entry via `nextPendingUpload`).
 * Must be rendered inside NetworkProvider and after auth is established.
 */
export function useUploadQueueProcessor() {
  const { isOnline } = useNetwork();
  const athleteId = useAuthStore((state) => state.athleteId);
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);
  const isProcessing = useRef(false);

  // One-off adoption of the pre-library pending_uploads queue, then of the
  // AsyncStorage index it writes into. Order matters: the queue migration adds
  // entries the adoption has to see.
  useEffect(() => {
    void migrateLegacyUploadQueue().then(adoptAsyncStorageIndex);
  }, []);

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
  useEffect(() => {
    reconcileProvisionalUploads().catch((err: unknown) => {
      log.warn(`Reconcile pass failed: ${String(err)}`);
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      let next = await nextPendingUpload();
      while (next) {
        log.log(`Processing pending upload: ${next.name} (${next.id})`);
        const result = await uploadRecording(next);

        if (result.outcome === 'permissionBlocked') {
          useUploadPermissionStore.getState().setHasWritePermission(false);
          break; // All subsequent uploads would also fail
        }
        if (result.outcome === 'network' || result.outcome === 'retriable') {
          break; // Backoff applies; wait for the next trigger
        }
        if (result.outcome === 'authExpired') {
          // Every entry would meet the same refused credential, and the ride is
          // held rather than spent. The sign-out this 401 triggers is what
          // gets the athlete back.
          break;
        }
        // uploaded / rejected / missing → move on to the next entry
        next = await nextPendingUpload();
      }
    } finally {
      isProcessing.current = false;
    }
  }, []);

  // Process when network comes online
  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline, processQueue]);

  // Process when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isOnline) {
        processQueue();
      }
    });
    return () => sub.remove();
  }, [isOnline, processQueue]);

  // Re-process after successful permission upgrade
  useEffect(() => {
    if (!needsUpgrade && isOnline) {
      processQueue();
    }
  }, [needsUpgrade, isOnline, processQueue]);

  // Periodic safety net for backoff-delayed retries
  useEffect(() => {
    if (!isOnline) return undefined;
    const interval = setInterval(processQueue, RETRY_TICK_MS);
    return () => clearInterval(interval);
  }, [isOnline, processQueue]);
}
