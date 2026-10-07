import { Alert } from 'react-native';

import { i18n } from '@/i18n';
import { navigateTo } from '@/shared/app/navigation';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatDateTime, formatDuration } from '@/shared/format/format';
import { movingMsAt, useRecordingStore } from '../stores/RecordingStore';
import type { RecordingBackup } from '../types';
import { resumeRecordingBackup, settleSavedBackup } from './restoreRecordingBackup';
import { clearRecordingBackup, loadRecordingBackup } from './storage/recordingBackup';

/**
 * Moving time the backup holds, up to its last save. A live ride's backup has
 * any open pause folded into `pausedDuration` already, so only a stopped ride
 * needs its own end.
 */
export function backupMovingMs(backup: RecordingBackup): number {
  const stopped = backup.status === 'stopped';
  return movingMsAt(
    {
      status: stopped ? 'stopped' : 'recording',
      startTime: backup.startTime,
      stopTime: stopped ? (backup.stopTime ?? backup.savedAt) : null,
      pausedDuration: backup.pausedDuration,
      _pauseStart: null,
    },
    backup.savedAt
  );
}

/**
 * The resume prompt's message. Discard deletes the ride, so the prompt says
 * which ride and how much of it before the athlete chooses.
 */
export function interruptedRecordingMessage(backup: RecordingBackup): string {
  return i18n.t('recording.resumePreviousMessage', {
    startTime: formatDateTime(new Date(backup.startTime).toISOString()),
    duration: formatDuration(backupMovingMs(backup) / 1000),
  });
}

function canOpenBackup(backup: RecordingBackup): boolean {
  const auth = useAuthStore.getState();
  return (
    auth.isAuthenticated &&
    !!backup.athleteId &&
    backup.athleteId === auth.athleteId &&
    useRecordingStore.getState().status === 'idle'
  );
}

/**
 * Offer back the ride an app kill interrupted. A session in memory owns the
 * backup file, so there is nothing to offer while one runs. The backup is
 * loaded before the alert so the alert can name it, and an unreadable file can
 * be neither named nor resumed, so it raises nothing and stays on disk. A
 * backup of a ride the library already holds is deleted instead of offered.
 */
export async function promptInterruptedRecording(): Promise<void> {
  if (useRecordingStore.getState().status !== 'idle') return;
  if (!useAuthStore.getState().isAuthenticated) return;
  const backup = await loadRecordingBackup();
  if (!backup || !canOpenBackup(backup)) return;
  if ((await settleSavedBackup(backup)) || !canOpenBackup(backup)) return;

  const t = i18n.t.bind(i18n);
  Alert.alert(t('recording.resumePrevious'), interruptedRecordingMessage(backup), [
    {
      text: t('recording.discard'),
      style: 'destructive',
      onPress: () => {
        if (canOpenBackup(backup)) void clearRecordingBackup(backup.athleteId, backup);
      },
    },
    {
      text: t('recording.controls.resume'),
      onPress: async () => {
        if (!canOpenBackup(backup)) return;
        const route = await resumeRecordingBackup();
        if (route) navigateTo(route);
      },
    },
  ]);
}
