import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';

import { useNetwork } from '@/shared/app/NetworkContext';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  nextPendingUpload,
  migrateLegacyUploadQueue,
} from '@/features/recording/lib/storage/recordingLibrary';
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
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);
  const isProcessing = useRef(false);

  // One-off adoption of the pre-library pending_uploads queue
  useEffect(() => {
    migrateLegacyUploadQueue();
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
    if (!isOnline) return;
    const interval = setInterval(processQueue, RETRY_TICK_MS);
    return () => clearInterval(interval);
  }, [isOnline, processQueue]);
}
