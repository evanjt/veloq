import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useNetwork } from '@/providers/NetworkContext';
import { intervalsApi } from '@/api';
import { dequeueUpload, markUploadComplete, markUploadFailed } from '@/lib/storage/uploadQueue';
import { debug } from '@/lib/utils/debug';

const log = debug.create('UploadQueue');

/**
 * Processes queued uploads when connectivity is restored or app comes to foreground.
 * Must be rendered inside NetworkProvider and after auth is established.
 */
export function useUploadQueueProcessor() {
  const { isOnline } = useNetwork();
  const isProcessing = useRef(false);

  const processQueue = async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      let entry = await dequeueUpload();
      while (entry) {
        log.log(`Processing queued upload: ${entry.name} (${entry.id})`);
        try {
          const fileInfo = await FileSystem.getInfoAsync(entry.filePath);
          if (!fileInfo.exists) {
            log.warn(`File not found, removing from queue: ${entry.filePath}`);
            await markUploadComplete(entry.id);
            entry = await dequeueUpload();
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
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.warn(`Upload failed: ${entry.name} — ${errMsg}`);
          await markUploadFailed(entry.id, errMsg);
          // Stop processing on failure — will retry next trigger
          break;
        }

        entry = await dequeueUpload();
      }
    } finally {
      isProcessing.current = false;
    }
  };

  // Process when network comes online
  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Process when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isOnline) {
        processQueue();
      }
    });
    return () => sub.remove();
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps
}
