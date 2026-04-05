/**
 * Auto-backup orchestration.
 *
 * Creates SQLite snapshots and uploads them to the configured backend.
 * Handles scheduling (throttled to once per 24h), retention (keep last 3),
 * and metadata collection.
 *
 * Triggers:
 * 1. After sync completion (new data arrived)
 * 2. App backgrounding (if last backup > 24h)
 * 3. App foregrounding (if last backup > 7d)
 */

import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { debug } from '@/lib/utils/debug';
import type { BackupBackend, BackupEntry } from './backends/types';
import { localBackend } from './backends/localBackend';

const log = debug.create('AutoBackup');
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

const SETTING_LAST_BACKUP = '__last_auto_backup';
const SETTING_BACKEND_ID = '__backup_backend';
const SETTING_AUTO_BACKUP_ENABLED = '__auto_backup_enabled';

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STALE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BACKUPS = 3;

/** Registry of available backends. */
const backends: Record<string, BackupBackend> = {
  local: localBackend,
};

/** Register a new backend (called at module load for platform-specific backends). */
export function registerBackend(backend: BackupBackend): void {
  backends[backend.id] = backend;
}

/** Get the user's configured backend (defaults to local). */
export function getConfiguredBackend(): BackupBackend {
  const engine = getRouteEngine();
  const backendId = engine?.getSetting(SETTING_BACKEND_ID) ?? 'local';
  return backends[backendId] ?? localBackend;
}

/** Set the user's preferred backup backend. */
export function setBackendPreference(backendId: string): void {
  const engine = getRouteEngine();
  engine?.setSetting(SETTING_BACKEND_ID, backendId);
}

/** Check if auto-backup is enabled (defaults to false). */
export function isAutoBackupEnabled(): boolean {
  const engine = getRouteEngine();
  return engine?.getSetting(SETTING_AUTO_BACKUP_ENABLED) === '1';
}

/** Enable or disable auto-backup. */
export function setAutoBackupEnabled(enabled: boolean): void {
  const engine = getRouteEngine();
  engine?.setSetting(SETTING_AUTO_BACKUP_ENABLED, enabled ? '1' : '0');
}

/** Get list of available backends on this device. */
export async function getAvailableBackends(): Promise<BackupBackend[]> {
  const available: BackupBackend[] = [];
  for (const backend of Object.values(backends)) {
    if (await backend.isAvailable()) {
      available.push(backend);
    }
  }
  return available;
}

/** Get timestamp of the last auto-backup, or null if never. */
export function getLastBackupTimestamp(): number | null {
  const engine = getRouteEngine();
  const value = engine?.getSetting(SETTING_LAST_BACKUP);
  return value != null ? Number(value) : null;
}

/**
 * Check if a backup should run based on throttling.
 * @param force - If true, skip time-based throttling (still checks if enabled)
 */
function shouldBackup(force = false): boolean {
  if (!isAutoBackupEnabled()) return false;

  if (force) return true;

  const lastBackup = getLastBackupTimestamp();
  if (!lastBackup) return true; // Never backed up

  return Date.now() - lastBackup >= MIN_INTERVAL_MS;
}

/**
 * Create a backup snapshot and upload it to the configured backend.
 * Returns true if a backup was created, false if skipped.
 */
export async function performBackup(force = false): Promise<boolean> {
  if (!shouldBackup(force)) return false;

  const engine = getRouteEngine();
  if (!engine) return false;

  const backend = getConfiguredBackend();
  if (!(await backend.isAvailable())) {
    log.log('Backend not available, skipping auto-backup');
    return false;
  }

  try {
    const timestamp = new Date().toISOString();
    const tempFilename = `veloq-autobackup-${Date.now()}.veloqdb`;
    const tempPath = `${FileSystem.cacheDirectory}${tempFilename}`;
    const plainPath = tempPath.startsWith('file://') ? tempPath.slice(7) : tempPath;

    // Create atomic SQLite snapshot
    engine.backupDatabase(plainPath);

    // Collect metadata
    const metadata = engine.getBackupMetadata();
    const entry: Omit<BackupEntry, 'id'> = {
      timestamp,
      sizeBytes: 0,
      appVersion: APP_VERSION,
      schemaVersion: Number(metadata.schema_version ?? 0),
      activityCount: Number(metadata.activity_count ?? 0),
      athleteId: (metadata.athlete_id as string) ?? null,
    };

    // Get file size
    const fileInfo = await FileSystem.getInfoAsync(tempPath);
    if (fileInfo.exists && 'size' in fileInfo) {
      entry.sizeBytes = fileInfo.size || 0;
    }

    // Upload to backend
    await backend.upload(tempPath, entry);

    // Clean up temp file
    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    // Update last backup timestamp
    engine.setSetting(SETTING_LAST_BACKUP, String(Date.now()));

    // Enforce retention (keep last N backups)
    await enforceRetention(backend);

    log.log(`Auto-backup complete: ${entry.activityCount} activities, ${entry.sizeBytes} bytes`);
    return true;
  } catch (error) {
    log.warn('Auto-backup failed:', error);
    return false;
  }
}

/** Delete old backups beyond the retention limit. */
async function enforceRetention(backend: BackupBackend): Promise<void> {
  try {
    const backups = await backend.listBackups();
    if (backups.length <= MAX_BACKUPS) return;

    // Delete oldest backups beyond the limit
    const toDelete = backups.slice(MAX_BACKUPS);
    for (const backup of toDelete) {
      await backend.delete(backup.id);
      log.log(`Deleted old backup: ${backup.id}`);
    }
  } catch {
    // Retention cleanup is best-effort
  }
}

/**
 * Trigger: call after sync completion.
 * Only backs up if auto-backup is enabled and enough time has passed.
 */
export function onSyncComplete(): void {
  performBackup().catch(() => {});
}

/**
 * Trigger: call when app goes to background.
 * Uses the standard 24h throttle.
 */
export function onAppBackground(): void {
  performBackup().catch(() => {});
}

/**
 * Trigger: call when app comes to foreground.
 * Only backs up if last backup is > 7 days old.
 */
export function onAppForeground(): void {
  if (!isAutoBackupEnabled()) return;

  const lastBackup = getLastBackupTimestamp();
  if (lastBackup && Date.now() - lastBackup < STALE_INTERVAL_MS) return;

  performBackup().catch(() => {});
}
