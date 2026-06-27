import { useEffect } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { BACKUP_INTERVAL_MS } from '../lib/constants';
import type { ActivityType } from '@/features/activity/types';
import type { RecordingMode, RecordingStatus } from '../types';

// Crash recovery: periodic backup
export function useCrashRecoveryBackupEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  mode: RecordingMode
) {
  useEffect(() => {
    if (status !== 'recording') return;
    const interval = setInterval(() => {
      const state = useRecordingStore.getState();
      if (state.status !== 'recording') return;
      saveRecordingBackup({
        activityType,
        mode,
        startTime: state.startTime ?? Date.now(),
        pausedDuration: state.pausedDuration,
        streams: state.streams,
        laps: state.laps,
        pairedEventId: state.pairedEventId,
        savedAt: Date.now(),
      });
    }, BACKUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, activityType, mode]);
}
