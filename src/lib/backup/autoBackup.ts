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
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { debug } from '@/lib/utils/debug';
import type { BackupBackend, BackupEntry } from './backends/types';
import { Platform } from 'react-native';
import { localBackend } from './backends/localBackend';
import { webdavBackend } from './backends/webdavBackend';
import { icloudBackend } from './backends/icloudBackend';

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
  webdav: webdavBackend,
  ...(Platform.OS === 'ios' ? { icloud: icloudBackend } : {}),
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

// ============================================================================
// WebDAV Credential Storage (SecureStore)
// ============================================================================

const WEBDAV_URL_KEY = 'veloq-webdav-url';
const WEBDAV_USERNAME_KEY = 'veloq-webdav-username';
const WEBDAV_PASSWORD_KEY = 'veloq-webdav-password';

// In-memory cache (SecureStore is async but we need sync access for isAvailable)
let _webdavCache: { url: string; username: string; password: string } | null = null;

/** Get WebDAV config (synchronous from cache, call initWebdavConfig first). */
export function getWebdavConfig(): { url: string; username: string; password: string } | null {
  return _webdavCache;
}

/** Load WebDAV config from SecureStore into cache. Call on app startup. */
export async function initWebdavConfig(): Promise<void> {
  try {
    const [url, username, password] = await Promise.all([
      SecureStore.getItemAsync(WEBDAV_URL_KEY),
      SecureStore.getItemAsync(WEBDAV_USERNAME_KEY),
      SecureStore.getItemAsync(WEBDAV_PASSWORD_KEY),
    ]);
    if (url && username && password) {
      _webdavCache = { url, username, password };
    } else {
      _webdavCache = null;
    }
  } catch {
    _webdavCache = null;
  }
}

/** Save WebDAV config to SecureStore and cache. */
export async function setWebdavConfig(
  url: string,
  username: string,
  password: string
): Promise<void> {
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  await Promise.all([
    SecureStore.setItemAsync(WEBDAV_URL_KEY, url, opts),
    SecureStore.setItemAsync(WEBDAV_USERNAME_KEY, username, opts),
    SecureStore.setItemAsync(WEBDAV_PASSWORD_KEY, password, opts),
  ]);
  _webdavCache = { url, username, password };
}

/** Clear WebDAV config from SecureStore and cache. */
export async function clearWebdavConfig(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(WEBDAV_URL_KEY),
    SecureStore.deleteItemAsync(WEBDAV_USERNAME_KEY),
    SecureStore.deleteItemAsync(WEBDAV_PASSWORD_KEY),
  ]);
  _webdavCache = null;
}
