import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  listRecordings,
  getRecording,
  requeueRecording,
  deleteRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import type { RecordingLibraryEntry } from '@/types';
import type { UploadRecordingResult } from '@/features/recording/lib/upload/uploadRecording';

export interface UseRecordingLibrary {
  entries: RecordingLibraryEntry[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  /** Requeue and immediately attempt an upload of one entry. */
  uploadNow: (id: string) => Promise<UploadRecordingResult | null>;
  remove: (id: string) => Promise<void>;
  uploadingId: string | null;
}

/** Query-on-demand list of locally saved recordings, refreshed on focus. */
export function useRecordingLibrary(): UseRecordingLibrary {
  const [entries, setEntries] = useState<RecordingLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listRecordings();
    setEntries(list);
    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const uploadNow = useCallback(
    async (id: string): Promise<UploadRecordingResult | null> => {
      setUploadingId(id);
      try {
        await requeueRecording(id);
        const entry = await getRecording(id);
        if (!entry) return null;
        const result = await uploadRecording(entry);
        if (result.outcome === 'permissionBlocked') {
          useUploadPermissionStore.getState().setHasWritePermission(false);
        }
        return result;
      } finally {
        setUploadingId(null);
        await refresh();
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteRecording(id);
      await refresh();
    },
    [refresh]
  );

  return { entries, isLoading, refresh, uploadNow, remove, uploadingId };
}
