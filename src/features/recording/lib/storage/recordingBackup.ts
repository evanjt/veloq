import * as FileSystem from 'expo-file-system/legacy';

import { debug } from '@/shared/debug/debug';
import type { RecordingBackup } from '@/types';

const log = debug.create('RecordingBackup');

const BACKUP_PATH = `${FileSystem.documentDirectory}recording_backup.json`;
const BACKUP_VERSION = 2;

/** Validate backup structure and version before restoring */
function isValidBackup(value: unknown): value is RecordingBackup {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== BACKUP_VERSION) return false;
  if (typeof obj.activityType !== 'string') return false;
  if (typeof obj.mode !== 'string') return false;
  if (obj.status !== 'recording' && obj.status !== 'paused' && obj.status !== 'stopped')
    return false;
  if (typeof obj.startTime !== 'number' || !Number.isFinite(obj.startTime)) return false;
  if (obj.stopTime !== null && typeof obj.stopTime !== 'number') return false;
  if (typeof obj.pausedDuration !== 'number') return false;
  if (typeof obj.savedAt !== 'number') return false;
  if (typeof obj.streams !== 'object' || obj.streams === null) return false;
  const streams = obj.streams as Record<string, unknown>;
  if (!Array.isArray(streams.time) || !Array.isArray(streams.latlng)) return false;
  if (!Array.isArray(obj.laps)) return false;
  return true;
}

/**
 * Build a backup from a live recording-store snapshot. Returns null when the
 * session has no restorable state (idle, or missing type/mode/startTime).
 * An in-progress pause is folded into pausedDuration so restore only needs to
 * credit the savedAt→restore gap.
 */
export function buildRecordingBackup(state: {
  status: string;
  activityType: string | null;
  mode: string | null;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  streams: RecordingBackup['streams'];
  laps: RecordingBackup['laps'];
  pairedEventId: number | null;
  _pauseStart: number | null;
}): RecordingBackup | null {
  const { status, activityType, mode, startTime } = state;
  if (status !== 'recording' && status !== 'paused' && status !== 'stopped') return null;
  if (!activityType || !mode || !startTime) return null;

  const now = Date.now();
  const ongoingPause = status === 'paused' && state._pauseStart ? now - state._pauseStart : 0;

  return {
    activityType: activityType as RecordingBackup['activityType'],
    mode: mode as RecordingBackup['mode'],
    status,
    startTime,
    stopTime: state.stopTime,
    pausedDuration: state.pausedDuration + ongoingPause,
    streams: state.streams,
    laps: state.laps,
    pairedEventId: state.pairedEventId,
    savedAt: now,
  };
}

export async function saveRecordingBackup(backup: RecordingBackup): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      BACKUP_PATH,
      JSON.stringify({ ...backup, version: BACKUP_VERSION })
    );
    log.log('Saved recording backup');
  } catch (error) {
    log.error('Failed to save recording backup:', error);
  }
}

export async function loadRecordingBackup(): Promise<RecordingBackup | null> {
  try {
    const info = await FileSystem.getInfoAsync(BACKUP_PATH);
    if (!info.exists) return null;

    const data = await FileSystem.readAsStringAsync(BACKUP_PATH);
    const parsed = JSON.parse(data);
    if (!isValidBackup(parsed)) {
      log.warn('Invalid or incompatible recording backup, discarding');
      return null;
    }
    return parsed;
  } catch {
    log.warn('Failed to load recording backup');
    return null;
  }
}

export async function clearRecordingBackup(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(BACKUP_PATH);
    if (info.exists) {
      await FileSystem.deleteAsync(BACKUP_PATH, { idempotent: true });
      log.log('Cleared recording backup');
    }
  } catch {
    // Best effort cleanup
  }
}

export async function hasRecordingBackup(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(BACKUP_PATH);
    return info.exists;
  } catch {
    return false;
  }
}
