/**
 * Auto-backup orchestration.
 *
 * Creates SQLite snapshots and uploads them to the configured backend.
 * Handles scheduling (throttled to once per 24h), retention (local storage
 * keeps the last MAX_LOCAL_BACKUPS, cloud backends keep everything), and
 * metadata collection.
 *
 * Triggers:
 * 1. After sync completion (new data arrived)
 * 2. App backgrounding (if last backup > 24h)
 * 3. App foregrounding (if last backup > 7d)
 */

import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { getEngine } from '@/shared/native/engine';
import { debug } from '@/shared/debug/debug';
import type { BackupBackend, BackupEntry } from './backends/types';
import { Platform } from 'react-native';
import { localBackend } from './backends/localBackend';
import { webdavBackend } from './backends/webdavBackend';
import { icloudBackend } from './backends/icloudBackend';
import { isBackupTransferError, type BackupFailureKind } from './backends/errors';
import { runDatabaseBackup } from '../runBackup';

const log = debug.create('AutoBackup');
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

const SETTING_LAST_BACKUP = '__last_auto_backup';
const SETTING_BACKEND_ID = '__backup_backend';
const SETTING_AUTO_BACKUP_ENABLED = '__auto_backup_enabled';
// Diagnostic state rather than a preference, so deliberately not in PREFERENCE_KEYS
const SETTING_LAST_FAILURE = '__last_backup_failure';

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STALE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_LOCAL_BACKUPS = 5;

/** Registry of available backends. */
const backends: Record<string, BackupBackend> = {
  local: localBackend,
  webdav: webdavBackend,
  ...(Platform.OS === 'ios' ? { icloud: icloudBackend } : {}),
};

/** Register a new backend (called at module load for platform-specific backends). */
export function registerBackend(backend: BackupBackend): void {
  backends[backend.id] = backend;
}

/** Get the user's configured backend (defaults to local). */
export function getConfiguredBackend(): BackupBackend {
  const engine = getEngine();
  const backendId = engine?.getSetting(SETTING_BACKEND_ID) ?? 'local';
  return backends[backendId] ?? localBackend;
}

/** Set the user's preferred backup backend. */
export function setBackendPreference(backendId: string): void {
  const engine = getEngine();
  engine?.setSetting(SETTING_BACKEND_ID, backendId);
}

/** Check if auto-backup is enabled (defaults to false). */
export function isAutoBackupEnabled(): boolean {
  const engine = getEngine();
  return engine?.getSetting(SETTING_AUTO_BACKUP_ENABLED) === '1';
}

/** Enable or disable auto-backup. */
export function setAutoBackupEnabled(enabled: boolean): void {
  const engine = getEngine();
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

/**
 * Backends the picker may offer, which is wider than the set that is ready
 * to run. WebDAV reports unavailable until it has credentials, but the user
 * enters those in the backup screen itself, so it has to stay selectable.
 * iCloud has no such in-app step, so it is only offered once available.
 */
const ALWAYS_OFFERABLE = new Set(['local', 'webdav']);

export async function getOfferableBackends(): Promise<BackupBackend[]> {
  const available = await getAvailableBackends();
  return Object.values(backends).filter(
    (backend) =>
      ALWAYS_OFFERABLE.has(backend.id) || available.some((ready) => ready.id === backend.id)
  );
}

/** Get timestamp of the last auto-backup, or null if never. */
export function getLastBackupTimestamp(): number | null {
  const engine = getEngine();
  const value = engine?.getSetting(SETTING_LAST_BACKUP);
  return value != null ? Number(value) : null;
}

export interface BackupFailure {
  kind: BackupFailureKind;
  status: number | null;
  /** Epoch millis of the attempt */
  at: number;
}

/**
 * The last failure that needs the user to act, or null.
 *
 * Only permanent failures are kept. A backup that lost the network will be
 * retried without anyone doing anything, so standing text about it would be
 * noise rather than information.
 */
export function getLastBackupFailure(): BackupFailure | null {
  const engine = getEngine();
  const raw = engine?.getSetting(SETTING_LAST_FAILURE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BackupFailure;
    return typeof parsed?.kind === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function clearBackupFailure(): void {
  getEngine()?.setSetting(SETTING_LAST_FAILURE, '');
}

function recordBackupFailure(error: unknown): void {
  if (!isBackupTransferError(error) || !error.permanent) return;
  const failure: BackupFailure = { kind: error.kind, status: error.status, at: Date.now() };
  getEngine()?.setSetting(SETTING_LAST_FAILURE, JSON.stringify(failure));
}

/**
 * Check if a backup should run based on throttling.
 * @param force - If true, skip time-based throttling (still checks if enabled)
 */
function shouldBackup(force = false): boolean {
  // Manual "Backup Now" should always work regardless of auto-backup setting
  if (force) return true;

  if (!isAutoBackupEnabled()) return false;

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

  const engine = getEngine();
  if (!engine) return false;

  const backend = getConfiguredBackend();
  if (!(await backend.isAvailable())) {
    log.log('Backend not available, skipping auto-backup');
    return false;
  }

  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) throw new Error('Device cache directory not available');

    const timestamp = new Date().toISOString();
    const tempFilename = `veloq-autobackup-${Date.now()}.veloqdb`;
    const tempPath = `${cacheDir}${tempFilename}`;
    const plainPath = tempPath.startsWith('file://') ? tempPath.slice(7) : tempPath;

    // Atomic SQLite snapshot, copied on a Rust thread
    await runDatabaseBackup(engine, plainPath);

    // Verify snapshot was created
    const fileInfo = await FileSystem.getInfoAsync(tempPath);
    if (!fileInfo.exists) {
      throw new Error('Database snapshot was not created');
    }

    // Collect metadata
    const metadata = engine.getBackupMetadata();
    const entry: Omit<BackupEntry, 'id'> = {
      timestamp,
      sizeBytes: 'size' in fileInfo ? fileInfo.size || 0 : 0,
      appVersion: APP_VERSION,
      schemaVersion: Number(metadata.schema_version ?? 0),
      activityCount: Number(metadata.activity_count ?? 0),
      athleteId: (metadata.athlete_id as string) ?? null,
    };

    // Upload to backend
    await backend.upload(tempPath, entry);

    // Clean up temp file
    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    // Update last backup timestamp
    engine.setSetting(SETTING_LAST_BACKUP, String(Date.now()));
    clearBackupFailure();

    // Local backups: enforce retention to prevent silent device storage growth.
    // Cloud/WebDAV backups: kept indefinitely - storage is the user's responsibility.
    if (backend.id === 'local') {
      await enforceRetention(backend, MAX_LOCAL_BACKUPS);
    }

    log.log(`Auto-backup complete: ${entry.activityCount} activities, ${entry.sizeBytes} bytes`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('Auto-backup failed:', msg);
    recordBackupFailure(error);
    // Rethrow the original so the caller keeps the failure kind
    throw error instanceof Error ? error : new Error(msg);
  }
}

/** Delete old backups beyond the retention limit (local storage only). */
async function enforceRetention(backend: BackupBackend, maxBackups: number): Promise<void> {
  try {
    const backups = await backend.listBackups();
    if (backups.length <= maxBackups) return;

    // Delete oldest backups beyond the limit
    const toDelete = backups.slice(maxBackups);
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

// WebDAV config re-exported from webdavConfig.ts (avoids circular dep with webdavBackend)
export {
  getWebdavConfig,
  initWebdavConfig,
  setWebdavConfig,
  clearWebdavConfig,
} from './webdavConfig';
