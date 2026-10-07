import { useCallback } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import {
  pauseRecordingManually,
  resumeRecordingManually,
} from '@/features/recording/lib/manualPause';
import type { ActivityType } from '@/features/activity';

export function useRecordingHandlers() {
  const handlePause = useCallback(() => pauseRecordingManually(), []);
  const handleResume = useCallback(() => resumeRecordingManually(), []);

  const handleLap = useCallback(() => {
    useRecordingStore.getState().addLap();
  }, []);

  // `stopRecording` ends the session, which stops the location watch, so the
  // handler does not tear down tracking itself. The stop sequence lives in
  // `endRecordingSession`, because the notification's STOP button has to do
  // the same three things and used to do only the first.
  const handleStop = useCallback(async () => {
    await endRecordingSession();
  }, []);

  const handleChangeType = useCallback((newType: ActivityType) => {
    useRecordingStore.getState().changeActivityType(newType);
  }, []);

  return { handlePause, handleResume, handleLap, handleStop, handleChangeType };
}
