import { useCallback } from 'react';
import { router } from 'expo-router';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { resetAutoPause } from '@/features/recording/lib/recordingSession';
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
  // watch, so neither handler tears down tracking itself. The stop sequence
  // itself lives in `endRecordingSession`, because the notification's STOP
  // button has to do the same three things and used to do only the first.
  const handleStop = useCallback(async () => {
    await endRecordingSession();
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
