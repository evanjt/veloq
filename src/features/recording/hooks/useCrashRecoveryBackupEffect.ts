import { useEffect } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  buildRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { BACKUP_INTERVAL_MS } from '../lib/constants';
import type { ActivityType } from '@/features/activity/types';
import type { RecordingMode, RecordingStatus } from '../types';

/**
 * Crash recovery backups. Writes immediately on every status transition
 * (recording, paused, and on each lap) plus a periodic interval while
 * recording, so a kill at any point loses at most BACKUP_INTERVAL_MS of data.
 * The stopped-state backup is written by handleStop; clearing happens only on
 * discard or after the recording is safely persisted.
 */
export function useCrashRecoveryBackupEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  mode: RecordingMode
) {
  const lapCount = useRecordingStore((s) => s.laps.length);

  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return;

    const write = () => {
      const backup = buildRecordingBackup(useRecordingStore.getState());
      if (backup) saveRecordingBackup(backup);
    };

    write();

    if (status !== 'recording') return;
    const interval = setInterval(write, BACKUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, activityType, mode, lapCount]);
}
