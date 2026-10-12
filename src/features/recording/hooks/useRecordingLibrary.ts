import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UploadResult } from 'veloqrs';

import {
  listVisibleRecordings,
  getVisibleRecording,
  deleteRecording,
  onRecordingsChanged,
  recordingFitExists,
} from '@/features/recording/lib/storage/recordingLibrary';
import { readRecordingTrack } from '@/features/recording/lib/storage/recordingTrack';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useEngineOpening, useEngineReady } from '@/shared/native/useEngineReady';
import type { RecordingLibraryEntry } from '@/types';

export interface UseRecordingLibrary {
  entries: RecordingLibraryEntry[];
  isLoading: boolean;
  /** What the last list read threw, or null when it answered. */
  error: unknown;
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
  const [error, setError] = useState<unknown>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const engine = useEngineReady();
  const opening = useEngineOpening();
  const readOn = useRef(engine);

  // Every read ends the load, so a throw shows as a failure with a retry
  // rather than a spinner nothing clears.
  const refresh = useCallback(async () => {
    try {
      setEntries(await listVisibleRecordings());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!engine) return undefined;
    // A handle that opened after the screen mounted, or replaced the one the
    // list was read on, holds a library the screen has not read yet.
    if (engine !== readOn.current) {
      readOn.current = engine;
      void refresh();
    }
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

  // A read before the engine opens throws, and is not the answer: the effect
  // above reads again the moment it opens.
  return {
    entries,
    isLoading: opening || isLoading,
    error: opening ? null : error,
    refresh,
    uploadNow,
    remove,
    uploadingId,
  };
}

export interface VisibleRecording {
  /** The recording, or null when it is not there or another athlete holds it. */
  entry: RecordingLibraryEntry | null;
  coordinates: [number, number][];
  fitAvailable: boolean;
  setFitAvailable: (available: boolean) => void;
  isLoading: boolean;
  /** What the last read threw, or null when it answered. */
  error: unknown;
  reload: () => Promise<void>;
}

async function readVisibleRecording(id: string | undefined): Promise<{
  entry: RecordingLibraryEntry | null;
  fitAvailable: boolean;
  coordinates: [number, number][];
}> {
  const entry = id ? await getVisibleRecording(id) : null;
  if (!entry) return { entry, fitAvailable: false, coordinates: [] };
  return {
    entry,
    fitAvailable: await recordingFitExists(entry),
    coordinates: await readRecordingTrack(entry),
  };
}

/**
 * One recording the signed-in athlete may see, with its track. Every read ends
 * the load: loaded, not found, or failed with the error kept for a retry.
 */
export function useVisibleRecording(id: string | undefined): VisibleRecording {
  const [entry, setEntry] = useState<RecordingLibraryEntry | null>(null);
  const [coordinates, setCoordinates] = useState<[number, number][]>([]);
  const [fitAvailable, setFitAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const engine = useEngineReady();
  const opening = useEngineOpening();

  const reload = useCallback(
    () =>
      readVisibleRecording(id).then(
        (read) => {
          setEntry(read.entry);
          setFitAvailable(read.fitAvailable);
          setCoordinates(read.coordinates);
          setError(null);
          setIsLoading(false);
        },
        (e: unknown) => {
          setError(e);
          setIsLoading(false);
        }
      ),
    [id]
  );

  // Read again when the engine opens or its handle is replaced: a read before
  // it opened threw and is not the answer.
  useEffect(() => {
    void reload();
  }, [reload, engine]);

  return {
    entry,
    coordinates,
    fitAvailable,
    setFitAvailable,
    isLoading: opening || isLoading,
    error: opening ? null : error,
    reload,
  };
}
