import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useNetwork } from '@/providers/NetworkContext';
import { useAuthStore, useUploadPermissionStore } from '@/providers';
import { intervalsApi } from '@/api';
import {
  dequeueUpload,
  markUploadComplete,
  markUploadFailed,
  markUploadPermissionBlocked,
} from '@/lib/storage/uploadQueue';
import { debug } from '@/lib/utils/debug';

const log = debug.create('UploadQueue');

/**
 * Processes queued uploads when connectivity is restored or app comes to foreground.
 * Must be rendered inside NetworkProvider and after auth is established.
 */
export function useUploadQueueProcessor() {
  const { isOnline } = useNetwork();
  const needsUpgrade = useUploadPermissionStore((s) => s.needsUpgrade);
  const isProcessing = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      let next = await dequeueUpload();
      while (next) {
        const entry = next;
        log.log(`Processing queued upload: ${entry.name} (${entry.id})`);
        try {
          const fileInfo = await FileSystem.getInfoAsync(entry.filePath);
          if (!fileInfo.exists) {
            log.warn(`File not found, removing from queue: ${entry.filePath}`);
            await markUploadComplete(entry.id);
            next = await dequeueUpload();
            continue;
          }

          const base64 = await FileSystem.readAsStringAsync(entry.filePath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          await intervalsApi.uploadActivity(bytes.buffer as ArrayBuffer, `${entry.name}.fit`, {
            name: entry.name,
            pairedEventId: entry.pairedEventId,
          });

          await markUploadComplete(entry.id);
          log.log(`Upload succeeded: ${entry.name}`);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Check if this is a non-retriable HTTP error (4xx except 408/429)
          const status =
            err && typeof err === 'object' && 'response' in err
              ? (err as { response?: { status?: number } }).response?.status
              : undefined;

          // 403: mark as permission-blocked — user needs to re-auth with ACTIVITY:WRITE
          if (status === 403) {
            log.warn(`Upload permission-blocked (403): ${entry.name}`);
            await markUploadPermissionBlocked(entry.id);
            useUploadPermissionStore.getState().setHasWritePermission(false);
            break; // All subsequent uploads will also fail
          }

          const isNonRetriable =
            status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;

          if (isNonRetriable) {
            log.warn(`Upload permanently failed (${status}): ${entry.name} — ${errMsg}`);
            await markUploadComplete(entry.id); // Remove from queue, won't succeed on retry
          } else {
            log.warn(`Upload failed: ${entry.name} — ${errMsg}`);
            await markUploadFailed(entry.id, errMsg);
          }
          // Stop processing — will retry retriable errors next trigger
          break;
        }

        next = await dequeueUpload();
      }
    } finally {
      isProcessing.current = false;
    }
  }, [isOnline]);

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

  // Re-process queue after successful permission upgrade
  useEffect(() => {
    if (!needsUpgrade && isOnline) {
      processQueue();
    }
  }, [needsUpgrade, isOnline, processQueue]);
}
