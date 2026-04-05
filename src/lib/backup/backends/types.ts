/**
 * Storage backend interface for auto-backup.
 *
 * Backends handle uploading/downloading SQLite snapshots to/from
 * cloud or local storage. The orchestration layer (autoBackup.ts)
 * handles scheduling, throttling, and retention.
 */

export interface BackupEntry {
  /** Unique identifier for this backup (backend-specific) */
  id: string;
  /** ISO 8601 timestamp of when the backup was created */
  timestamp: string;
  /** Backup file size in bytes */
  sizeBytes: number;
  /** App version that created this backup */
  appVersion: string;
  /** SQLite schema version */
  schemaVersion: number;
  /** Number of activities in the backup */
  activityCount: number;
  /** Athlete ID (for cross-account protection) */
  athleteId: string | null;
}

export interface BackupBackend {
  /** Unique backend identifier (e.g., 'local', 'icloud', 'webdav') */
  id: string;
  /** Display name for the UI (e.g., 'iCloud', 'Nextcloud') */
  name: string;

  /** Check if this backend is available on the current device/platform. */
  isAvailable(): Promise<boolean>;

  /** List all existing backups, newest first. */
  listBackups(): Promise<BackupEntry[]>;

  /**
   * Upload a backup file.
   * @param localPath - Absolute filesystem path to the .veloqdb file
   * @param metadata - Backup metadata for the entry
   */
  upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void>;

  /**
   * Download a backup file to a local path.
   * @param backupId - ID from a BackupEntry
   * @param destPath - Local filesystem path to write to
   */
  download(backupId: string, destPath: string): Promise<void>;

  /** Delete a backup. */
  delete(backupId: string): Promise<void>;
}
