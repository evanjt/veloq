import { useCallback } from 'react';
import { router } from 'expo-router';
import type { MutableRefObject } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { navigateTo } from '@/shared/app/navigation';
import type { createAutoPauseDetector } from '@/features/recording/lib/autoPause';
import type { ActivityType } from '@/features/activity/types';

type AutoPauseDetector = ReturnType<typeof createAutoPauseDetector>;

export function useRecordingHandlers({
  autoPauseDetectorRef,
  stopTracking,
  setAutoPaused,
  setShowTypePicker,
}: {
  autoPauseDetectorRef: MutableRefObject<AutoPauseDetector>;
  stopTracking: () => Promise<void>;
  setAutoPaused: (paused: boolean) => void;
  setShowTypePicker: (show: boolean) => void;
}) {
  const handlePause = useCallback(() => {
    autoPauseDetectorRef.current.reset();
    setAutoPaused(false);
    useRecordingStore.getState().pauseRecording();
  }, [autoPauseDetectorRef, setAutoPaused]);

  const handleResume = useCallback(() => {
    autoPauseDetectorRef.current.reset();
    setAutoPaused(false);
    useRecordingStore.getState().resumeRecording();
  }, [autoPauseDetectorRef, setAutoPaused]);

  const handleLap = useCallback(() => {
    useRecordingStore.getState().addLap();
  }, []);

  const handleStop = useCallback(async () => {
    useRecordingStore.getState().stopRecording();
    await stopTracking();
    await clearRecordingBackup();
    navigateTo('/recording/review');
  }, [stopTracking]);

  const handleDiscard = useCallback(async () => {
    useRecordingStore.getState().reset();
    await stopTracking();
    await clearRecordingBackup();
    router.replace('/');
  }, [stopTracking]);

  const handleChangeType = useCallback(
    (newType: ActivityType) => {
      useRecordingStore.getState().changeActivityType(newType);
      setShowTypePicker(false);
    },
    [setShowTypePicker]
  );

  return { handlePause, handleResume, handleLap, handleStop, handleDiscard, handleChangeType };
}
