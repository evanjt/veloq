import { useCallback } from 'react';
import { router } from 'expo-router';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  buildRecordingBackup,
  clearRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { resetAutoPause } from '@/features/recording/lib/recordingSession';
import { navigateTo } from '@/shared/app/navigation';
import type { ActivityType } from '@/features/activity/types';

export function useRecordingHandlers({
  setShowTypePicker,
}: {
  setShowTypePicker: (show: boolean) => void;
}) {
  const handlePause = useCallback(() => {
    resetAutoPause();
    useRecordingStore.getState().pauseRecording();
  }, []);

  const handleResume = useCallback(() => {
    resetAutoPause();
    useRecordingStore.getState().resumeRecording();
  }, []);

  const handleLap = useCallback(() => {
    useRecordingStore.getState().addLap();
  }, []);

  // `stopRecording` and `reset` end the session, which stops the location
  // watch, so neither handler tears down tracking itself.
  const handleStop = useCallback(async () => {
    useRecordingStore.getState().stopRecording();
    // Persist the stopped session so an app kill on the review screen cannot
    // lose the recording. Cleared only after a successful save or a discard.
    const backup = buildRecordingBackup(useRecordingStore.getState());
    if (backup) await saveRecordingBackup(backup);
    navigateTo('/recording/review');
  }, []);

  const handleDiscard = useCallback(async () => {
    useRecordingStore.getState().reset();
    await clearRecordingBackup();
    router.replace('/');
  }, []);

  const handleChangeType = useCallback(
    (newType: ActivityType) => {
      useRecordingStore.getState().changeActivityType(newType);
      setShowTypePicker(false);
    },
    [setShowTypePicker]
  );

  return { handlePause, handleResume, handleLap, handleStop, handleDiscard, handleChangeType };
}
