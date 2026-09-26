import { useRecordingStore, streamTotals } from '../stores/RecordingStore';
import type { RecordingBackup } from '@/types';

/** Restore the whole ride before session listeners can write a backup. */
export function restoreRecordingBackup(backup: RecordingBackup): string {
  const now = Date.now();
  const stopped = backup.status === 'stopped';
  useRecordingStore.setState({
    activityType: backup.activityType,
    mode: backup.mode,
    pairedEventId: backup.pairedEventId ?? null,
    startTime: backup.startTime,
    stopTime: stopped ? (backup.stopTime ?? backup.savedAt) : null,
    pausedDuration: backup.pausedDuration + (stopped ? 0 : Math.max(0, now - backup.savedAt)),
    pauseIntervals: stopped
      ? (backup.pauseIntervals ?? [])
      : [
          ...(backup.pauseIntervals ?? []),
          {
            start: (backup.savedAt - backup.startTime) / 1000,
            end: (Math.max(now, backup.savedAt) - backup.startTime) / 1000,
          },
        ],
    streams: backup.streams,
    totals: streamTotals(backup.streams),
    laps: backup.laps,
    status: stopped ? 'stopped' : 'paused',
    _pauseStart: stopped ? null : now,
    latestSensor: { heartrate: null, power: null, cadence: null },
    rawSpeed: null,
    _lastRawFix: null,
  });
  return stopped ? '/recording/review' : `/recording/${backup.activityType}`;
}
