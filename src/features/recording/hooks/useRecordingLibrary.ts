import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UploadResult } from 'veloqrs';

import {
  listVisibleRecordings,
  getVisibleRecording,
  deleteRecording,
  onRecordingsChanged,
} from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useEngineReady } from '@/shared/native/useEngineReady';
import type { RecordingLibraryEntry } from '@/types';

export interface UseRecordingLibrary {
  entries: RecordingLibraryEntry[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  /** Requeue and immediately attempt an upload of one entry. */
  uploadNow: (id: string) => Promise<UploadResult | null>;
  remove: (id: string) => Promise<void>;
  uploadingId: string | null;
}

/**
 * Locally saved recordings, refreshed on focus and whenever the engine moves
 * one's upload, which its schedule does with the list on screen.
 */
export function useRecordingLibrary(): UseRecordingLibrary {
  const [entries, setEntries] = useState<RecordingLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const engine = useEngineReady();

  const refresh = useCallback(async () => {
    const list = await listVisibleRecordings();
    setEntries(list);
    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!engine) return undefined;
    return onRecordingsChanged(() => {
      void refresh();
    });
  }, [engine, refresh]);

  const uploadNow = useCallback(
    async (id: string): Promise<UploadResult | null> => {
      setUploadingId(id);
      try {
        // Only a ride this athlete may see is offered. The engine holds
        // another athlete's ride for them whatever this screen shows.
        if (!(await getVisibleRecording(id))) return null;
        return await uploadRecordingNow(id);
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
