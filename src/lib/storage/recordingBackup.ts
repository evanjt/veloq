import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import type { RecordingBackup } from '@/types';

const log = debug.create('RecordingBackup');

const BACKUP_PATH = `${FileSystem.documentDirectory}recording_backup.json`;

export async function saveRecordingBackup(backup: RecordingBackup): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(BACKUP_PATH, JSON.stringify(backup));
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
    return JSON.parse(data) as RecordingBackup;
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
