/**
 * Backup & restore.
 *
 * Two formats:
 * - .veloqdb: SQLite database snapshot (primary, complete backup)
 * - .veloq:   Legacy JSON backup (custom sections, names, preferences only)
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouteEngine, getRouteDbPath, getNativeModule } from '@/shared/native/routeEngine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';
import { shareFile } from './shareFile';
import { getSetting, setSetting } from '@/shared/storage';
import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { initializeInsightsStore } from '@/features/insights/store';
import { initializeTileCacheStore } from '@/features/maps/stores/TileCacheStore';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { initializeDisabledSections } from '@/features/routes/stores/DisabledSectionsStore';
import { initializePotentialSections } from '@/features/routes/stores/PotentialSectionsStore';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeSectionDismissals } from '@/features/routes/stores/SectionDismissalsStore';
import { initializeSupersededSections } from '@/features/routes/stores/SupersededSectionsStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeSupportStore } from '@/shared/app/SupportStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { initializeTheme } from '@/shared/app/ThemeProvider';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { queryClient } from '@/shared/query/QueryProvider';
import { reloadCameraOverrides } from '@/features/maps/lib/storage/terrainCameraOverrides';
import { reloadMapCameraState } from '@/features/maps/lib/storage/mapCameraState';
import Constants from 'expo-constants';
import { z } from 'zod';
import { debug } from '@/shared/debug/debug';

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
const log = debug.create('Backup');

// ============================================================================
// Shared helpers
// ============================================================================

/** Reinitialize all Zustand stores from storage (SQLite + AsyncStorage). */
export async function reinitializeAllStores(): Promise<void> {
  await Promise.all([
    initializeTheme(),
    initializeLanguage(),
    initializeSportPreference(),
    initializeHRZones(),
    initializeUnitPreference(),
    initializeRouteSettings(),
    initializeDisabledSections(),
    initializeSectionDismissals(),
    initializeSupersededSections(),
    initializePotentialSections(),
    initializeDashboardPreferences(),
    initializeDebugStore(),
    initializeTileCacheStore(),
    initializeWhatsNewStore(),
    initializeInsightsStore(),
    initializeRecordingPreferences(),
    initializeUploadPermission(),
    initializeNotificationPreferences(),
    initializeNotificationPrompt(),
    initializeSupportStore(),
    reloadCameraOverrides(),
    reloadMapCameraState(),
  ]);
}

// ============================================================================
// SQLite database backup (.veloqdb)
// ============================================================================

const DatabaseBackupMetadataSchema = z.object({
  schema_version: z.coerce.string(),
  activity_count: z.number(),
  section_count: z.number(),
  gps_track_count: z.number(),
  oldest_date: z.number().nullable(),
  newest_date: z.number().nullable(),
  athlete_id: z.string().nullable(),
});

export type DatabaseBackupMetadata = z.infer<typeof DatabaseBackupMetadataSchema>;

// Shape returned by the native `validateBackupDatabase` pre-restore probe.
// Narrower than DatabaseBackupMetadataSchema: the probe only reads the three
// fields it needs to gate the restore, so validate against exactly those.
const BackupValidationSchema = z.object({
  schema_version: z.coerce.string(),
  athlete_id: z.string().nullable(),
  activity_count: z.number(),
});

/** Export a full SQLite database snapshot via the OS share sheet. */
export async function exportDatabaseBackup(): Promise<void> {
  const engine = getRouteEngine();
  if (!engine) throw new Error('Engine not initialized');

  const date = formatLocalDate(new Date());
  const filename = `veloq-backup-${date}.veloqdb`;
  const destPath = `${FileSystem.cacheDirectory}${filename}`;

  // Strip file:// prefix for Rust (expects plain filesystem path)
  const plainPath = destPath.startsWith('file://') ? destPath.slice(7) : destPath;
  engine.backupDatabase(plainPath);

  // Share the file
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(destPath, {
    mimeType: 'application/octet-stream',
    UTI: 'public.database',
  });
}

/** Get metadata about the current database (for UI display). */
export function getDatabaseBackupMetadata(): DatabaseBackupMetadata | null {
  const engine = getRouteEngine();
  if (!engine) return null;
  const raw = engine.getBackupMetadata();
  const result = DatabaseBackupMetadataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export interface DatabaseRestoreResult {
  success: boolean;
  activityCount: number;
  error?: string;
  /** Warning if the backup's athlete ID doesn't match the currently logged-in user. */
  athleteIdMismatch?: boolean;
  /** The athlete ID from the backup (if available). */
  backupAthleteId?: string | null;
}

/**
 * Restore from a .veloqdb SQLite snapshot.
 * This replaces the entire database — all activities, sections, settings.
 *
 * Pre-validates the backup (not empty, schema not newer than this build,
 * athlete ID) BEFORE touching the live database, and snapshots the live DB to
 * a `.bak` so a failed restore rolls back instead of leaving the user with a
 * destroyed database. An absent native probe is the only reason validation is
 * skipped — a probe that rejects or throws refuses the restore.
 */
export async function restoreDatabaseBackup(fileUri: string): Promise<DatabaseRestoreResult> {
  const dbPath = getRouteDbPath();
  if (!dbPath) {
    return { success: false, activityCount: 0, error: 'Cannot determine database path' };
  }

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists || fileInfo.size === 0) {
    return { success: false, activityCount: 0, error: 'Backup file is empty or missing' };
  }

  // Copy to a unique temp path so Rust can open it (fileUri may be a content://
  // URI). Unique so a stale leftover or a concurrent attempt can't collide.
  const tempPath = `${FileSystem.cacheDirectory}restore-validation-${Date.now()}.veloqdb`;
  const cleanupTemp = () => FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});

  try {
    await FileSystem.copyAsync({ from: fileUri, to: tempPath });
    const plainTempPath = tempPath.startsWith('file://') ? tempPath.slice(7) : tempPath;

    const currentAthleteId = useAuthStore.getState().athleteId;
    let backupAthleteId: string | null = null;

    const nativeModule = getNativeModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validateFn = (nativeModule as any)?.validateBackupDatabase as
      | ((path: string) => string)
      | undefined;

    // Only skip validation when the native probe is entirely absent (older
    // binary). If it exists and rejects or throws, refuse — never overwrite the
    // live DB on a bad backup.
    if (validateFn) {
      let backupMeta: z.infer<typeof BackupValidationSchema>;
      try {
        backupMeta = BackupValidationSchema.parse(JSON.parse(validateFn(plainTempPath)));
      } catch (e) {
        await cleanupTemp();
        log.warn('Backup validation failed — refusing to restore', e);
        return { success: false, activityCount: 0, error: 'Backup file is corrupt or unreadable' };
      }

      backupAthleteId = backupMeta.athlete_id;

      // An empty/garbage SQLite file reports activity_count 0 — refuse so a bad
      // file can't silently wipe the live database.
      if (backupMeta.activity_count <= 0) {
        await cleanupTemp();
        log.warn('Backup contains no activities — refusing to restore');
        return { success: false, activityCount: 0, error: 'Backup file is empty or corrupt' };
      }

      // Refuse a backup whose schema is newer than this build can open. We don't
      // hardcode the current version: probe the live DB with the same fn and
      // compare. If the live DB can't be read (fresh install), skip this guard —
      // the activity-count check and the .bak rollback still protect the user.
      const livePlainPath = dbPath.startsWith('file://') ? dbPath.slice(7) : dbPath;
      try {
        const liveMeta = BackupValidationSchema.parse(JSON.parse(validateFn(livePlainPath)));
        if (Number(backupMeta.schema_version) > Number(liveMeta.schema_version)) {
          await cleanupTemp();
          log.warn('Backup schema is newer than this app supports — refusing to restore');
          return {
            success: false,
            activityCount: 0,
            error: 'Backup is from a newer version of Veloq',
          };
        }
      } catch {
        // Live schema unreadable (e.g. fresh install) — forward-version guard skipped.
      }

      if (
        currentAthleteId != null &&
        backupAthleteId != null &&
        currentAthleteId !== backupAthleteId
      ) {
        await cleanupTemp();
        return {
          success: false,
          activityCount: 0,
          athleteIdMismatch: true,
          backupAthleteId,
          error: 'Backup belongs to a different athlete',
        };
      }
    }

    // Snapshot the live DB so a failed restore can roll back. destroyEngine first
    // so the snapshot is a clean, closed copy.
    const engine = getRouteEngine();
    if (engine) {
      engine.destroyEngine();
    }

    const liveExists = (await FileSystem.getInfoAsync(`file://${dbPath}`)).exists;
    const backupPath = `${dbPath}.bak`;
    if (liveExists) {
      await FileSystem.copyAsync({ from: `file://${dbPath}`, to: `file://${backupPath}` });
    }

    try {
      await FileSystem.copyAsync({ from: tempPath, to: `file://${dbPath}` });

      if (nativeModule) {
        nativeModule.routeEngine.initWithPath(dbPath);
      }

      await reinitializeAllStores();
      await AsyncStorage.removeItem('veloq-query-cache');

      const restoredEngine = getRouteEngine();
      const activityCount = restoredEngine?.getActivityCount() ?? 0;

      // Wake query-on-demand hooks so mounted screens re-query the restored data
      // instead of showing the pre-restore engine state until the next sync.
      restoredEngine?.notifyAll('activities', 'groups', 'sections', 'syncReset');
      queryClient.invalidateQueries();

      // Restore succeeded — drop the rollback snapshot.
      if (liveExists) {
        await FileSystem.deleteAsync(`file://${backupPath}`, { idempotent: true });
      }

      return { success: true, activityCount, athleteIdMismatch: false, backupAthleteId };
    } catch (error) {
      // Restore failed after the live DB was overwritten — roll back to the snapshot.
      if (liveExists) {
        try {
          await FileSystem.copyAsync({ from: `file://${backupPath}`, to: `file://${dbPath}` });
          await FileSystem.deleteAsync(`file://${backupPath}`, { idempotent: true });
        } catch {
          // Rollback copy failed — leave the .bak in place for manual recovery.
        }
      }
      try {
        if (nativeModule) {
          nativeModule.routeEngine.initWithPath(dbPath);
        }
      } catch {
        // Engine recovery failed — app may need restart
      }

      return {
        success: false,
        activityCount: 0,
        error: error instanceof Error ? error.message : 'Restore failed',
      };
    }
  } finally {
    await cleanupTemp();
  }
}

// ============================================================================
// Legacy JSON backup (.veloq) — kept for backward compatibility
// ============================================================================

const LEGACY_BACKUP_VERSION = 2;

/**
 * AsyncStorage keys for legacy JSON backup.
 *
 * Deliberately excluded (cache or device state, re-derivable, wrong to restore
 * onto another install): 'veloq-query-cache', 'veloq-pending-terrain-snapshots',
 * 'terrain-preview-cache-version', 'veloq-upload-queue' (points at local FIT
 * files that are not in the backup), 'veloq-section-health-check-v1'.
 */
const LEGACY_PREFERENCE_KEYS = [
  'veloq-theme-preference',
  'veloq-language-preference',
  'veloq-unit-preference',
  'veloq-primary-sport',
  'veloq-map-preferences',
  'veloq-route-settings',
  'veloq-hr-zones',
  'veloq-debug-mode',
  'veloq-disabled-sections',
  'veloq-section-dismissals',
  'veloq-superseded-sections',
  'veloq-potential-sections',
  'dashboard_preferences',
  'dashboard_summary_card',
  '@terrain_camera_overrides',
  '@map_camera_state',
  'veloq-map-activity-overrides',
  'veloq-tile-cache',
  'veloq-whats-new-seen',
  'veloq-insights-fingerprint',
  'veloq-notification-prompt-dismissed',
  'veloq-recording-preferences',
  'veloq-geocoded-route-ids',
  'veloq-geocoded-section-ids',
  'veloq-notification-preferences',
  'veloq-upload-permission',
  'veloq-support-store',
] as const;

interface BackupCustomSection {
  name: string;
  sportType: string;
  sourceActivityId: string;
  startIndex: number;
  endIndex: number;
}

interface BackupData {
  version: number;
  exportedAt: string;
  appVersion: string;
  customSections: BackupCustomSection[];
  sectionNames: Record<string, string>;
  routeNames: Record<string, string>;
  preferences: Record<string, unknown>;
}

export interface RestoreResult {
  sectionsRestored: number;
  sectionsFailed: { name: string; reason: string }[];
  namesApplied: number;
  namesSkipped: number;
  preferencesRestored: number;
}

export async function createBackup(): Promise<string> {
  const engine = getRouteEngine();

  // Collect custom sections (slim format — no polyline or distanceMeters)
  const customSections: BackupCustomSection[] = [];
  if (engine) {
    const sections = engine.getSectionsByType('custom');
    for (const s of sections) {
      customSections.push({
        name: s.name || '',
        sportType: s.sportType,
        sourceActivityId: s.sourceActivityId || '',
        startIndex: s.startIndex ?? 0,
        endIndex: s.endIndex ?? 0,
      });
    }
  }

  // Collect names
  const sectionNames = engine?.getAllSectionNames() ?? {};
  const routeNames = engine?.getAllRouteNames() ?? {};

  // Collect preferences from SQLite first, then AsyncStorage fallback
  const preferences: Record<string, unknown> = {};
  for (const key of LEGACY_PREFERENCE_KEYS) {
    try {
      const value = await getSetting(key);
      if (value !== null) {
        try {
          preferences[key] = JSON.parse(value);
        } catch {
          preferences[key] = value;
        }
      }
    } catch {
      // Skip unreadable keys
    }
  }

  const backup: BackupData = {
    version: LEGACY_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    customSections,
    sectionNames,
    routeNames,
    preferences,
  };

  return JSON.stringify(backup, null, 2);
}

export async function exportBackup(): Promise<void> {
  const json = await createBackup();
  const date = formatLocalDate(new Date());
  await shareFile({
    content: json,
    filename: `veloq-backup-${date}.veloq`,
    mimeType: 'application/json',
  });
}

export async function restoreBackup(json: string): Promise<RestoreResult> {
  let backup: BackupData;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup file format');
  }

  if (backup.version === undefined || backup.version === null) {
    throw new Error('Corrupt backup: missing version field');
  }

  if (backup.version > LEGACY_BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version: ${backup.version}. This app supports version ${LEGACY_BACKUP_VERSION}.`
    );
  }

  const result: RestoreResult = {
    sectionsRestored: 0,
    sectionsFailed: [],
    namesApplied: 0,
    namesSkipped: 0,
    preferencesRestored: 0,
  };

  const engine = getRouteEngine();

  // Restore custom sections
  if (engine && Array.isArray(backup.customSections) && backup.customSections.length > 0) {
    for (const cs of backup.customSections) {
      try {
        if (!cs.sourceActivityId) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'No source activity ID',
          });
          continue;
        }

        // Check if source activity exists
        const track = engine.getGpsTrack(cs.sourceActivityId);
        if (!track || track.length === 0) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'Source activity not synced',
          });
          continue;
        }

        // Validate startIndex < endIndex
        if (cs.startIndex >= cs.endIndex) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: `Invalid index range: startIndex (${cs.startIndex}) must be less than endIndex (${cs.endIndex})`,
          });
          continue;
        }

        // Validate indices are within track bounds
        if (cs.startIndex >= track.length || cs.endIndex >= track.length) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: `Indices out of range (${cs.startIndex}-${cs.endIndex} vs track length ${track.length})`,
          });
          continue;
        }

        const sectionId = engine.createSectionFromIndices(
          cs.sourceActivityId,
          cs.startIndex,
          cs.endIndex,
          cs.sportType,
          cs.name || undefined
        );
        if (!sectionId) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'Engine returned empty section ID',
          });
          continue;
        }
        result.sectionsRestored++;
      } catch {
        result.sectionsFailed.push({
          name: cs.name || 'Unnamed',
          reason: 'Creation failed',
        });
      }
    }
  }

  // Restore section names
  if (engine && backup.sectionNames) {
    for (const [id, name] of Object.entries(backup.sectionNames)) {
      try {
        engine.setSectionName(id, name);
        result.namesApplied++;
      } catch {
        result.namesSkipped++;
      }
    }
  }

  // Restore route names
  if (engine && backup.routeNames) {
    for (const [id, name] of Object.entries(backup.routeNames)) {
      try {
        engine.setRouteName(id, name);
        result.namesApplied++;
      } catch {
        result.namesSkipped++;
      }
    }
  }

  // Restore preferences
  if (backup.preferences) {
    for (const [key, value] of Object.entries(backup.preferences)) {
      try {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        await setSetting(key, stringValue);
        result.preferencesRestored++;
      } catch {
        // Skip unwritable keys
      }
    }

    await reinitializeAllStores();
  }

  return result;
}
