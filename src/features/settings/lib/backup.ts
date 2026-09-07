/**
 * Backup & restore.
 *
 * Two formats:
 * - .veloqdb: SQLite database snapshot (primary, complete backup)
 * - .veloq:   Legacy JSON backup (custom sections, names, preferences only)
 */

import { Alert } from 'react-native';
import { i18n } from '@/i18n';
import * as FileSystem from 'expo-file-system/legacy';
import { getEngine, getRouteDbPath, getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';
import { setSetting } from '@/shared/storage';
import { runDatabaseBackup } from '@/features/settings/lib/runBackup';
import { shareExistingFile } from '@/features/settings/lib/shareFile';
import { initializeSportPreference, initializeHRZones } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { initializeInsightsStore } from '@/features/insights/store';
import { migrateTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import { initializeRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { initializeKnownSensors } from '@/features/sensors/store';
import { initializeUploadPermission } from '@/features/recording/stores/UploadPermissionStore';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeHeatmapPreference } from '@/features/maps/stores/HeatmapPreferenceStore';
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
import { startElevationBackfillAfterUpdate } from '@/features/routes/lib/elevationBackfillTrigger';
import { clearDatabaseStamps } from '@/shared/storage/databaseStamps';
import { startDetectorCutoverAfterUpdate } from '@/features/routes/lib/cutoverTrigger';
import { z } from 'zod';
import { debug } from '@/shared/debug/debug';
import { rememberCachedAthleteId } from '@/shared/storage/cachedAthleteId';

const log = debug.create('Backup');

// ============================================================================
// Shared helpers
// ============================================================================

const STORE_INITIALISERS: readonly (readonly [string, () => Promise<unknown>])[] = [
  ['initializeTheme', initializeTheme],
  ['initializeLanguage', initializeLanguage],
  ['initializeSportPreference', initializeSportPreference],
  ['initializeHRZones', initializeHRZones],
  ['initializeUnitPreference', initializeUnitPreference],
  ['initializeRouteSettings', initializeRouteSettings],
  ['initializeHeatmapPreference', initializeHeatmapPreference],
  ['initializeDashboardPreferences', initializeDashboardPreferences],
  ['initializeDebugStore', initializeDebugStore],
  ['migrateTileCacheSettings', migrateTileCacheSettings],
  ['initializeWhatsNewStore', initializeWhatsNewStore],
  ['initializeInsightsStore', initializeInsightsStore],
  ['initializeRecordingPreferences', initializeRecordingPreferences],
  ['initializeKnownSensors', initializeKnownSensors],
  ['initializeUploadPermission', initializeUploadPermission],
  ['initializeNotificationPreferences', initializeNotificationPreferences],
  ['initializeNotificationPrompt', initializeNotificationPrompt],
  ['initializeSupportStore', initializeSupportStore],
  ['reloadCameraOverrides', reloadCameraOverrides],
  ['reloadMapCameraState', reloadMapCameraState],
];

/**
 * Reinitialize all Zustand stores from storage (SQLite + AsyncStorage).
 *
 * Settled, not all: one store failing to load must not leave the rest on
 * pre-restore state.
 */
export async function reinitializeAllStores(): Promise<void> {
  const results = await Promise.allSettled(STORE_INITIALISERS.map(([, init]) => init()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      log.error(`${STORE_INITIALISERS[index][0]} failed`, result.reason);
    }
  });
}

const BackupValidationSchema = z.object({
  schema_version: z.coerce.string(),
  athlete_id: z.string().nullable(),
  activity_count: z.number(),
  // Absent on a binary older than the field. The live database is then the
  // only comparison left, which is what this replaced.
  supported_schema_version: z.number().optional(),
  // Older binaries answer without it, and an undated backup reads as unknown.
  newest_activity: z.number().nullable().optional(),
});

/**
 * The live database's schema version, for a binary too old to report its own.
 * Null when the file cannot be read, which is every fresh install.
 */
function liveSchemaVersion(validateFn: (path: string) => string, dbPath: string): number | null {
  const livePlainPath = dbPath.startsWith('file://') ? dbPath.slice(7) : dbPath;
  try {
    const liveMeta = BackupValidationSchema.parse(JSON.parse(validateFn(livePlainPath)));
    return Number(liveMeta.schema_version);
  } catch {
    return null;
  }
}

interface DatabaseReplacementArgs {
  backupActivityCount: number | null;
  backupNewestActivity: number | null;
  liveActivityCount: number;
  liveNewestActivity: number | null;
}

/** Epoch seconds as a local date, or a dash when the side has no date. */
function describeDate(epochSeconds: number | null): string {
  if (epochSeconds == null) return '\u2014';
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

/**
 * Ask before a picked file replaces a library that is still on the device.
 * Resolves whether the athlete accepted. The counts and dates are both sides
 * of the trade, because an older snapshot of the same account is the one
 * mis-pick nothing else here can catch.
 */
function confirmDatabaseReplacement(args: DatabaseReplacementArgs): Promise<boolean> {
  const t = i18n.t.bind(i18n);
  const body = t('backup.replaceLiveMessage', {
    backupCount: args.backupActivityCount ?? '?',
    backupDate: describeDate(args.backupNewestActivity),
    liveCount: args.liveActivityCount,
    liveDate: describeDate(args.liveNewestActivity),
    defaultValue:
      'This will replace the library on this device ({{liveCount}} activities, newest {{liveDate}}) with the backup ({{backupCount}} activities, newest {{backupDate}}). Anything on the device that is not in the backup is deleted and cannot be recovered.',
  });

  return new Promise((resolve) => {
    Alert.alert(
      t('backup.replaceLiveTitle', { defaultValue: 'Replace this device\u2019s library?' }),
      body,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: t('backup.replaceLiveConfirm', { defaultValue: 'Replace' }),
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ]
    );
  });
}

/** Engine dates arrive as bigint over the FFI, and as null when there are none. */
function toEpochSeconds(value: number | bigint | null | undefined): number | null {
  return value == null ? null : Number(value);
}

/** Export a full SQLite database snapshot via the OS share sheet. */
export async function exportDatabaseBackup(): Promise<void> {
  const engine = getEngine();
  if (!engine) throw new Error('Engine not initialized');

  const date = formatLocalDate(new Date());
  const filename = `veloq-backup-${date}.veloqdb`;
  const destPath = `${FileSystem.cacheDirectory}${filename}`;

  // Strip file:// prefix for Rust (expects plain filesystem path)
  const plainPath = destPath.startsWith('file://') ? destPath.slice(7) : destPath;
  await runDatabaseBackup(engine, plainPath);

  await shareExistingFile(destPath, 'application/octet-stream');
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
 * This replaces the entire database - all activities, sections, settings.
 *
 * Pre-validates the backup (not empty, schema not newer than this build,
 * athlete ID) BEFORE touching the live database, and snapshots the live DB to
 * a `.bak` so a failed restore rolls back instead of leaving the user with a
 * destroyed database. An absent native probe is the only reason validation is
 * skipped - a probe that rejects or throws refuses the restore.
 */
/**
 * A database is three files, not one. SQLite applies a `-wal` it finds beside a
 * database on the next open, so a copy that names only the main file can leave
 * one belonging to the file it just replaced.
 *
 * Closing the engine first is not enough on its own: a clean close deletes the
 * pair, but only for the last connection, and the backup source
 * (`persistence/export.rs`) and the detection worker each hold one on a
 * background thread. Quarantine already moves all three together
 * (`persistence/mod.rs`), and this is the same shape on the restore side.
 */
const DB_SIDECARS = ['-wal', '-shm'] as const;

/** Copy `from` and whichever sidecars exist beside it to `to`. */
async function copyDatabaseSet(from: string, to: string): Promise<void> {
  await FileSystem.copyAsync({ from: `file://${from}`, to: `file://${to}` });
  for (const suffix of DB_SIDECARS) {
    try {
      const beside = `file://${from}${suffix}`;
      if ((await FileSystem.getInfoAsync(beside)).exists) {
        await FileSystem.copyAsync({ from: beside, to: `file://${to}${suffix}` });
      }
    } catch {
      // A sibling that vanished under us is already gone from the set, which
      // is all the copy needs. The main file is what the caller waits on.
    }
  }
}

/** Remove whichever sidecars sit beside `path`, so none outlives its database. */
async function clearDatabaseSidecars(path: string): Promise<void> {
  for (const suffix of DB_SIDECARS) {
    await FileSystem.deleteAsync(`file://${path}${suffix}`, { idempotent: true }).catch(() => {});
  }
}

export async function restoreDatabaseBackup(fileUri: string): Promise<DatabaseRestoreResult> {
  const dbPath = getRouteDbPath();
  if (!dbPath) {
    return {
      success: false,
      activityCount: 0,
      error: 'Cannot determine database path',
    };
  }

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists || fileInfo.size === 0) {
    return {
      success: false,
      activityCount: 0,
      error: 'Backup file is empty or missing',
    };
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
    let backupMeta: z.infer<typeof BackupValidationSchema> | null = null;

    const nativeModule = getNativeModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validateFn = (nativeModule as any)?.validateBackupDatabase as
      | ((path: string) => string)
      | undefined;

    // Only skip validation when the native probe is entirely absent (older
    // binary). If it exists and rejects or throws, refuse - never overwrite the
    // live DB on a bad backup.
    if (validateFn) {
      try {
        backupMeta = BackupValidationSchema.parse(JSON.parse(validateFn(plainTempPath)));
      } catch (e) {
        await cleanupTemp();
        log.warn('Backup validation failed - refusing to restore', e);
        return {
          success: false,
          activityCount: 0,
          error: 'Backup file is corrupt or unreadable',
        };
      }

      backupAthleteId = backupMeta.athlete_id;

      // An empty/garbage SQLite file reports activity_count 0 - refuse so a bad
      // file can't silently wipe the live database.
      if (backupMeta.activity_count <= 0) {
        await cleanupTemp();
        log.warn('Backup contains no activities - refusing to restore');
        return {
          success: false,
          activityCount: 0,
          error: 'Backup file is empty or corrupt',
        };
      }

      // Refuse a backup whose schema is newer than this build can open.
      // Migrations only run upward, so such a file is missing every column the
      // newer code added and fails at query time rather than at open. The
      // comparison is against this build's own version, which a fresh install
      // can answer and an unreadable live database cannot.
      const supported =
        backupMeta.supported_schema_version ?? liveSchemaVersion(validateFn, dbPath);
      if (supported !== null && Number(backupMeta.schema_version) > supported) {
        await cleanupTemp();
        log.warn('Backup schema is newer than this app supports - refusing to restore');
        return {
          success: false,
          activityCount: 0,
          error: 'Backup is from a newer version of Veloq',
        };
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

    const engine = getEngine();

    // The live library is about to go, and the rollback copy is deleted on
    // success, so this is the last point anything can be kept. A device with
    // nothing on it has nothing to trade and is not asked.
    if ((engine?.getActivityCount() ?? 0) > 0) {
      const accepted = await confirmDatabaseReplacement({
        backupActivityCount: backupMeta?.activity_count ?? null,
        backupNewestActivity: backupMeta?.newest_activity ?? null,
        liveActivityCount: engine?.getActivityCount() ?? 0,
        liveNewestActivity: toEpochSeconds(engine?.getStats()?.newestDate),
      });
      if (!accepted) {
        await cleanupTemp();
        return {
          success: false,
          activityCount: 0,
          error: 'Restore cancelled',
        };
      }
    }

    const liveExists = (await FileSystem.getInfoAsync(`file://${dbPath}`)).exists;
    const backupPath = `${dbPath}.bak`;
    // Whether the rollback copy is a complete one. A snapshot that threw
    // half-written must never be copied back over a live database that is
    // still intact.
    let snapshotTaken = false;

    // The engine quarantines an unopenable database (renames it aside and
    // starts fresh), so a corrupt restored file would otherwise read as a
    // "successful" init with zero data, and the rollback snapshot would be
    // deleted. Detect a quarantine event during THIS init and treat it as a
    // failed restore instead.
    const dbDir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    const dbBase = dbPath.substring(dbPath.lastIndexOf('/') + 1);
    const listQuarantined = async (): Promise<string[]> => {
      try {
        const names = await FileSystem.readDirectoryAsync(`file://${dbDir}`);
        return names.filter((n) => n.startsWith(`${dbBase}.corrupt-`));
      } catch {
        return [];
      }
    };
    const quarantinedBefore = new Set(await listQuarantined());

    try {
      // Both the close and the snapshot sit inside the guard: a copy that
      // throws here has to return a result and leave the engine open, not
      // escape past the caller's own error handling.
      if (engine) {
        engine.destroyEngine();
      }
      if (liveExists) {
        await copyDatabaseSet(dbPath, backupPath);
        snapshotTaken = true;
      }

      // The imported file arrives on its own, so anything left beside the
      // database it replaces belongs to the database that is going.
      await clearDatabaseSidecars(dbPath);
      await FileSystem.copyAsync({ from: tempPath, to: `file://${dbPath}` });

      if (nativeModule) {
        const ok = nativeModule.engine.initWithPath(dbPath);
        const newlyQuarantined = (await listQuarantined()).some((n) => !quarantinedBefore.has(n));
        if (!ok || newlyQuarantined) {
          throw new Error('Restored database could not be opened');
        }
      }

      await reinitializeAllStores();

      const restoredEngine = getEngine();
      const activityCount = restoredEngine?.getActivityCount() ?? 0;

      // Whose library is now on the device. A restore from the login screen
      // has no credentials to read it from, and without the stamp every
      // identity check answers "nothing cached" for a full database.
      if (backupAthleteId) {
        restoredEngine?.setSetting('__athlete_id', backupAthleteId);
        await rememberCachedAthleteId(backupAthleteId);
      }

      // Wake query-on-demand hooks so mounted screens re-query the restored data
      // instead of showing the pre-restore engine state until the next sync.
      restoredEngine?.notifyAll('activities', 'groups', 'sections', 'syncReset');
      queryClient.invalidateQueries();

      // The recording index came with the file, but the FIT files it points at
      // did not: they are on the device that made the backup. A restored row is
      // a library entry whose ride cannot be opened or uploaded, so the table
      // goes the way the AsyncStorage index was left out of the JSON backup.
      restoredEngine?.clearRecordings();

      // The restored database is not the one the launch triggers ran against.
      // Every stamp that described the replaced database goes first, and then
      // both triggers run here rather than waiting for a cold start: the
      // engine-init effect does not re-run on a restore.
      await clearDatabaseStamps();
      await startElevationBackfillAfterUpdate().catch(() => false);
      await startDetectorCutoverAfterUpdate().catch(() => {});

      // Restore succeeded - drop the rollback snapshot, all of it.
      if (snapshotTaken) {
        await FileSystem.deleteAsync(`file://${backupPath}`, {
          idempotent: true,
        });
        await clearDatabaseSidecars(backupPath);
      }

      return {
        success: true,
        activityCount,
        athleteIdMismatch: false,
        backupAthleteId,
      };
    } catch (error) {
      // Restore failed after the live DB was overwritten - roll back to the
      // snapshot. Close the engine first: it may hold an open connection to
      // the file being replaced (and initWithPath below would otherwise
      // no-op on its already-initialized guard).
      try {
        getEngine()?.destroyEngine();
      } catch {
        // Best-effort. Proceed with the rollback copy regardless.
      }
      if (snapshotTaken) {
        try {
          // The half-restored database's own sidecars go first: rolling back
          // under them would apply the wrong log to the file coming back.
          await clearDatabaseSidecars(dbPath);
          await copyDatabaseSet(backupPath, dbPath);
          await FileSystem.deleteAsync(`file://${backupPath}`, {
            idempotent: true,
          });
          await clearDatabaseSidecars(backupPath);
        } catch {
          // Rollback copy failed - leave the .bak in place for manual recovery.
        }
      }
      try {
        if (nativeModule) {
          nativeModule.engine.initWithPath(dbPath);
        }
      } catch {
        // Engine recovery failed - app may need restart
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
// Legacy JSON backup (.veloq) - kept for backward compatibility
// ============================================================================

const LEGACY_BACKUP_VERSION = 2;

/**
 * AsyncStorage keys for legacy JSON backup.
 *
 * Deliberately excluded (cache or device state, re-derivable, wrong to restore
 * onto another install): 'veloq-query-cache', 'veloq-pending-terrain-snapshots',
 * 'terrain-preview-cache-version', 'veloq-recording-library' (the pre-table
 * index, points at local FIT files that are not in the backup, and the
 * `recordings` table that replaced it is dropped on a `.veloqdb` restore for
 * the same reason), 'veloq-section-health-check-v1',
 * 'veloq-push-token-refreshed-at' (device-local refresh throttle; restoring a
 * stale timestamp could suppress a needed re-registration for a day),
 * 'veloq-elevation-backfill-version' (device-local completion marker; restoring
 * it onto another install would suppress that device's own backfill). A
 * `.veloqdb` restore clears those markers instead, because it replaces the very
 * database they described, and the list of them is `DATABASE_LOCAL_STAMPS`; the
 * legacy JSON path below does not touch the database, so it leaves them alone
 *.
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
  'veloq-known-sensors',
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

export async function restoreBackup(json: string): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup file format');
  }

  // The file is user-picked, so nothing about its shape is guaranteed. A bare
  // `null` parses fine and then throws on any property access.
  const envelope = z.object({ version: z.number() }).safeParse(parsed);
  if (!envelope.success) {
    throw new Error('Corrupt backup: missing version field');
  }

  const backup = parsed as BackupData;

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

  const engine = getEngine();

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
    // Only keys the export writes. Without this a hand-edited file can put any
    // key into SQLite, and reinitializeAllStores then loads it into a store.
    const restorable = new Set<string>(LEGACY_PREFERENCE_KEYS);
    for (const [key, value] of Object.entries(backup.preferences)) {
      if (!restorable.has(key)) continue;
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
