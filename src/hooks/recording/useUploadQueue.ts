import { useCallback } from 'react';
import { enqueueUpload } from '@/lib/storage/uploadQueue';
import type { ActivityType } from '@/types';

export interface QueueUploadParams {
  fitBuffer: ArrayBuffer;
  activityType: ActivityType;
  name: string;
  pairedEventId: number | null;
}

export interface UseUploadQueue {
  /**
   * Persist the FIT buffer to disk and enqueue it for background upload.
   * Returns `true` if the enqueue succeeded, `false` if either the file
   * write or the queue write failed (caller should then show a save-error
   * message — the activity data is lost in that case, so the UX matters).
   */
  queueUpload: (params: QueueUploadParams) => Promise<boolean>;
}

/**
 * Encapsulates the "upload failed due to network, queue for later" fallback.
 * Writes the FIT buffer to `documentDirectory/pending_uploads/<timestamp>.fit`
 * as base64 and records an entry via `enqueueUpload`. The background upload
 * worker picks it up on the next connectivity event.
 */
export function useUploadQueue(): UseUploadQueue {
  const queueUpload = useCallback(async (params: QueueUploadParams): Promise<boolean> => {
    try {
      const FileSystem = require('expo-file-system/legacy');
      const dir = `${FileSystem.documentDirectory}pending_uploads/`;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }

      const filePath = `${dir}${Date.now()}.fit`;
      const bytes = new Uint8Array(params.fitBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await FileSystem.writeAsStringAsync(filePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await enqueueUpload({
        filePath,
        activityType: params.activityType,
        name: params.name,
        pairedEventId: params.pairedEventId ?? undefined,
        createdAt: Date.now(),
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { queueUpload };
}
