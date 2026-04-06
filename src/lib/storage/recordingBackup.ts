import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import type { RecordingBackup } from '@/types';

const log = debug.create('RecordingBackup');

const BACKUP_PATH = `${FileSystem.documentDirectory}recording_backup.json`;
const BACKUP_VERSION = 1;

/** Validate backup structure and version before restoring */
function isValidBackup(value: unknown): value is RecordingBackup {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== BACKUP_VERSION) return false;
  if (typeof obj.activityType !== 'string') return false;
  if (typeof obj.mode !== 'string') return false;
  if (typeof obj.startTime !== 'number' || !Number.isFinite(obj.startTime)) return false;
  if (typeof obj.pausedDuration !== 'number') return false;
  if (typeof obj.savedAt !== 'number') return false;
  if (typeof obj.streams !== 'object' || obj.streams === null) return false;
  const streams = obj.streams as Record<string, unknown>;
  if (!Array.isArray(streams.time) || !Array.isArray(streams.latlng)) return false;
  if (!Array.isArray(obj.laps)) return false;
  return true;
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
