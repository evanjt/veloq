import { useCallback } from 'react';
import { router } from 'expo-router';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';

/**
 * Throws the unsaved ride away: resets the recording store, clears the crash
 * backup and returns to `/`. The control that calls it owns the confirmation.
 */
export function useDiscardRecording(): () => void {
  return useCallback(() => {
    useRecordingStore.getState().reset();
    clearRecordingBackup();
    router.replace('/');
  }, []);
}
