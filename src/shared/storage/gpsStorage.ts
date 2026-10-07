/**
 * FileSystem cleanup and size measurement for the caches the app writes outside Rust.
 *
 * GPS track storage functions have been removed - all GPS data is now stored
 * exclusively in the Rust SQLite engine (routes.db gps_tracks table).
 * The clearAllGpsTracks() function is retained for cleanup of any legacy files.
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';
import { getPlatformAppStorageStats } from '@/shared/native/appStorageStats';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';
import {
  LEGACY_HEATMAP_TILES_DIR,
  readHeatmapTilesCacheSize,
} from '@/features/maps/lib/heatmapTiles';
import {
  clearTerrainPreviews,
  forgetPendingSnapshots,
  getTerrainPreviewCacheSize,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { clearCrashLog } from '@/shared/debug/crashLog';
import { forgetCachedAthleteId, forgetStoredActivityCount } from './cachedAthleteId';
import { deleteRecordTemporaries, platformRecordUri } from './platformRecord';
import { clearImageDiskCache } from '@/shared/native/imageDiskCache';
import { deleteCachedAthleteFiles } from './cacheFiles';
import { LEGACY_LIBRARY_KEYS } from './migrateSettingsToSqlite';
import { removeSetting } from './settingsStorage';
import { forgetInsightFingerprint } from '@/features/insights/lib/fingerprintStore';

const log = debug.create('GpsStorage');

const GPS_DIR = `${FileSystem.documentDirectory}gps_tracks/`;

/**
 * Clear all legacy GPS track files (cleanup only).
 * GPS data is now stored in the Rust SQLite engine.
 */
export async function clearAllGpsTracks(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(GPS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(GPS_DIR, { idempotent: true });
      log.log('Cleared legacy GPS tracks directory');
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Delete legacy GPS track files by activity ID (cleanup only).
 */
export async function deleteGpsTracks(activityIds: string[]): Promise<void> {
  if (activityIds.length === 0) return;

  const results = await Promise.allSettled(
    activityIds.map((id) => {
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      return FileSystem.deleteAsync(`${GPS_DIR}${safeId}.json`, { idempotent: true });
    })
  );

  const failedCount = results.filter((r) => r.status === 'rejected').length;
  if (failedCount > 0) {
    log.log(`Warning: ${failedCount}/${activityIds.length} GPS track deletes failed`);
  }
}

// =============================================================================
// Cache files owned by the account wipe below
// =============================================================================

const CACHE_DIR = `${FileSystem.documentDirectory}bounds_cache/`;
const BOUNDS_CACHE_FILE = `${CACHE_DIR}bounds.json`;
const ROUTE_NAMES_FILE = `${CACHE_DIR}route_names.json`;

export async function clearBoundsCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(BOUNDS_CACHE_FILE);
    if (info.exists) {
      await FileSystem.deleteAsync(BOUNDS_CACHE_FILE, { idempotent: true });
      log.log('Cleared bounds cache');
    }
  } catch {
    // Best effort
  }
}

// =============================================================================
// Routes Database Size (Rust SQLite)
// =============================================================================

// Asked rather than spelled: since the database moved into the App Group
// container on iOS there is one answer and `engine.ts` holds it.
function routesDbPath(): string | null {
  const path = getRouteDbPath();
  return path === null ? null : `file://${path}`;
}

/**
 * Get the size of a single file, returning 0 if it doesn't exist.
 */
async function getFileSize(path: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && 'size' in info) {
      return info.size || 0;
    }
  } catch {
    // Ignore
  }
  return 0;
}

/**
 * Estimate routes SQLite database size in bytes.
 * Includes the main .db file plus WAL and SHM journal files,
 * which can be substantial in WAL mode.
 */
export async function estimateRoutesDatabaseSize(): Promise<number> {
  const path = routesDbPath();
  if (path === null) return 0;
  const [main, wal, shm] = await Promise.all([
    getFileSize(path),
    getFileSize(`${path}-wal`),
    getFileSize(`${path}-shm`),
  ]);
  return main + wal + shm;
}

/**
 * One bucket's bytes, or zero if it cannot answer. A bucket that throws is
 * not worth losing the other three over: the figure is a subtitle, and the
 * engine is not open on every screen that reads it.
 */
async function bucketSize(read: () => number | Promise<number>): Promise<number> {
  try {
    return (await read()) || 0;
  } catch {
    return 0;
  }
}

/** Bytes in the files directly inside `dir`, which holds a handful and no subdirectory. */
async function flatDirectorySize(dir: string): Promise<number> {
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  const sizes = await Promise.all(names.map((name) => getFileSize(`${dir}${name}`)));
  return sizes.reduce((total, size) => total + size, 0);
}

/**
 * The copies of the library and the backups kept beside it: the quarantined
 * and displaced databases with their sidecars, the backup directory older
 * builds wrote, the recordings, and the share, restore and snapshot files in
 * the cache. Each directory is small and flat, unlike the tile trees.
 */
async function athleteFilesSize(): Promise<number> {
  const documents = FileSystem.documentDirectory;
  const cache = FileSystem.cacheDirectory;
  const dbPath = getRouteDbPath();
  // Required lazily: the sidecar module reaches the native module at import.
  const { setAsideCopies } =
    require('@/features/settings/lib/databaseSidecars') as typeof import('@/features/settings/lib/databaseSidecars');
  const { SHARE_COPY_PREFIX, AUTOBACKUP_SNAPSHOT_PREFIX } =
    require('@/features/settings/lib/autobackup/backends/localBackend') as typeof import('@/features/settings/lib/autobackup/backends/localBackend');
  const { EXPORTS_DIR, RESTORES_DIR } =
    require('@/shared/storage/cacheFiles') as typeof import('@/shared/storage/cacheFiles');

  const reads: Promise<number>[] = [];
  if (dbPath !== null) {
    reads.push(
      setAsideCopies(dbPath)
        .then((uris) => Promise.all(uris.map(getFileSize)))
        .then(sum)
    );
  }
  if (documents) {
    reads.push(
      flatDirectorySize(`${documents}backups/`),
      flatDirectorySize(`${documents}recordings/`)
    );
  }
  if (cache) {
    reads.push(
      flatDirectorySize(`${cache}${EXPORTS_DIR}`),
      flatDirectorySize(`${cache}${RESTORES_DIR}`)
    );
    reads.push(
      FileSystem.readDirectoryAsync(cache)
        .catch(() => [] as string[])
        .then((names) =>
          Promise.all(
            names
              .filter(
                (n) => n.startsWith(SHARE_COPY_PREFIX) || n.startsWith(AUTOBACKUP_SNAPSHOT_PREFIX)
              )
              .map((n) => getFileSize(`${cache}${n}`))
          )
        )
        .then(sum)
    );
  }
  return sum(await Promise.all(reads));
}

/**
 * Bytes held by the library copies, backups, recordings and share files, or
 * zero if they cannot be read. The one reader of that bucket: the settings hub
 * total and the cache screen's legend both take it from here.
 */
export function getAthleteFilesSize(): Promise<number> {
  return bucketSize(athleteFilesSize);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Total app storage usage. On Android it is the platform's own figure for the
 * app, data plus cache, so settings reads what Android's app info reads. Where
 * that is unavailable, and on iOS, it is the sum of the buckets that know their
 * own size.
 *
 * Three of them answer natively, the database is three files and the rest are
 * small flat directories, so nothing here touches the tile trees. Walking `documentDirectory` and `cacheDirectory`
 * instead cost one `getInfoAsync` round trip per tile, awaited in series on
 * the JS thread, over the two largest trees the app writes.
 */
export async function getAppStorageSize(): Promise<number> {
  const platform = await platformStorageTotal();
  if (platform !== null) return platform;
  return getBucketedStorageSize();
}

async function platformStorageTotal(): Promise<number | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const stats = await getPlatformAppStorageStats();
    return stats ? stats.dataBytes + stats.cacheBytes : null;
  } catch {
    return null;
  }
}

/** The sum of the five buckets, each by its own length figure. */
export async function getBucketedStorageSize(): Promise<number> {
  const sizes = await Promise.all([
    bucketSize(estimateRoutesDatabaseSize),
    bucketSize(readHeatmapTilesCacheSize),
    bucketSize(() => {
      // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
      // import time, and this module is imported by cleanup paths that run in
      // tests and on web, where that module does not exist.
      const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
      return basemapStore().getCacheSize();
    }),
    bucketSize(getTerrainPreviewCacheSize),
    getAthleteFilesSize(),
  ]);
  return sizes.reduce((total, size) => total + size, 0);
}

// =============================================================================
// Comprehensive Cache Clearing (for auth transitions)
// =============================================================================

/**
 * Lightweight cleanup for the "Sign out (keep data)" path.
 *
 * Drops the previous session, which is the persisted TanStack Query blob and
 * the in-memory cache, and nothing else. Activities, GPS tracks, sections and
 * bounds stay, and so do the athlete profile and the sport settings: they are
 * the same athlete's, they can only be refilled by a sync, and a sign-out
 * offline would otherwise cost the photo, the name and every sport setting
 * until the radio came back. The destructive path is `clearAccountData`, which
 * is what a different athlete on the phone takes.
 *
 * Nothing draws them while signed out. `useAthlete` reads only while there is
 * a credential, so the previous athlete cannot appear on the login screen.
 */
export async function clearAuthOnly(queryClient: { clear: () => void }): Promise<void> {
  queryClient.clear();

  log.log('Cleared the session cache, keeping the athlete profile');
}

/**
 * Empty the library and everything kept beside it that names its athlete.
 *
 * The one wipe every path takes when a library goes: Sign out and delete data,
 * Clear & Sync when another athlete signs in, and the launch wipe of another
 * athlete's empty library. Whatever is added beside the library is deleted
 * here, so no path can leave it behind.
 *
 * Clears:
 * - Rust engine cache including athlete_profile + sport_settings, the record
 *   restore state, and the heatmap tiles whether or not the heatmap is on
 *   (engine.clear())
 * - The decisions zip, which names the athlete and every decision, and which
 *   the device backup would carry to the next phone, and the temporary file or
 *   conversion copy the engine leaves beside it when killed before the rename
 * - Every backup file: the local backups and old database copies, which the
 *   login screen offers to whoever opens an empty library, and the restore
 *   copies in the cache
 * - The derived-data clear's rollback copy of the library, which a clear
 *   killed part way leaves beside the database
 * - The quarantined copy of a database that would not open, which launch
 *   keeps beside the new one for the salvage
 * - Every athlete file in the cache: the share sheet's copies (backups,
 *   activity exports, GPX, crash logs), notification route pictures, the
 *   document picker's import copies and the restore copies
 * - Every notification in the tray and the schedule, which carry ride names,
 *   PRs and route pictures and would open in the next athlete's library
 * - The backup carrier: WebDAV server and password, backend, toggle, last run
 *   and last failure, so the next athlete's records never go to this one's
 *   server
 * - A key queued offline, and the notification consent and preferences, with
 *   the push token unregistered first so no turned-off toggle leaves it on the
 *   server
 * - FileSystem GPS tracks, bounds, route names, terrain previews
 * - The home-screen widget's snapshot, which carries the latest ride with its
 *   route outline and the athlete's wellness, and the launcher shortcuts
 * - The mirrored athlete id and activity count
 * - The insight fingerprint, whose constant ids would otherwise hide the next
 *   athlete's own cards from them
 * - Everything kept by activity id outside the library: camera and map
 *   overrides, the dismissed track notice, the pending preview list, the
 *   background task's run log and push times, the section and route id keys an
 *   older build left, and the activity pushes still queued on Android, with
 *   each store's memory emptied so its next write cannot put them back
 * - The last map position, heart rate zones set by hand and paired sensors,
 *   with the sensors disconnected and each store's memory emptied
 * - The crash log and the engine's panic log, whose messages can name a ride,
 *   and the scopes the previous account granted
 * - The heatmap builds before 0.3.0 drew into Documents
 *
 * Rejects when the engine wipe fails, so a caller never reports a library gone
 * that is still there.
 */
/**
 * Empty the Rust basemap tile store, whose pinned ground maps the athlete's
 * activity bounds. The store's own clear keeps the directory and the
 * excluded-from-backup attribute on it. When the store was never opened, a
 * launch whose `setPath` failed, there is no handle to clear, so the directory
 * goes instead.
 */
async function clearBasemapTiles(): Promise<void> {
  try {
    // Required lazily, as in `getAppStorageSize`.
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    await basemapStore().clearTiles();
  } catch {
    const documents = FileSystem.documentDirectory;
    if (documents) {
      await FileSystem.deleteAsync(`${documents}basemap-tiles`, { idempotent: true });
    }
  }
}

export async function wipeLibrary(): Promise<void> {
  // Note: cannot delete the database file - Rust PERSISTENT_ENGINE global holds
  // the connection and VeloqEngine.create() skips re-init if the global is Some.
  //
  // The login screen runs with the engine closed, and both Try Demo and a
  // sign-in to another account wipe from there, so the path goes with the
  // request: a closed handle opens the real database rather than skipping the
  // wipe the athlete has just accepted.
  const engine = getEngine();
  const dbPath = getRouteDbPath();
  // Before the wipe names nothing, so the library the athlete signs in to next
  // cannot be read as the one an older build's ownerless data was left beside.
  const { settleOwnerlessAdoptions } =
    require('@/features/recording') as typeof import('@/features/recording');
  await settleOwnerlessAdoptions();
  if (engine) await engine.clear(dbPath ?? undefined);

  const { forgetPendingBulkExport } = require('@/features/settings/lib/bulkExport');
  forgetPendingBulkExport();
  const { clearPendingApiKey } = require('@/features/auth/lib/pendingSignIn');
  const { clearWebdavConfig } = require('@/features/settings/lib/autobackup/webdavConfig');
  const { forgetBackupCarrier } = require('@/features/settings/lib/autobackup/autoBackup');
  const { deleteBackupFiles } = require('@/features/settings/lib/autobackup/backends/localBackend');
  const {
    useNotificationPreferences,
  } = require('@/features/settings/stores/NotificationPreferencesStore');
  const { releasePushRegistration, useAuthStore } = require('@/shared/app/AuthStore');
  const { deleteClearSnapshot } = require('@/features/settings/lib/clearSnapshot');
  const { deleteSetAsideCopies } = require('@/features/settings/lib/databaseSidecars');
  const { dismissAllNotifications } = require('@/features/settings/lib/notificationService');
  const { clearWidgetSnapshot } = require('@/features/home/lib/widgetBridge');
  const { deletePanicLog } = require('@/features/settings/lib/databaseSidecars');
  const { forgetMapCameraState } = require('@/features/maps/lib/storage/mapCameraState');
  const { forgetKnownSensors } = require('@/features/sensors/store');
  const { disconnectAllSensors } = require('@/features/sensors/lib/sensorManager');
  const { forgetCameraOverrides } = require('@/features/maps/lib/storage/terrainCameraOverrides');
  const { forgetTrackFetchDismissal } = require('@/features/routes/lib/trackFetchNotice');
  const { clearTaskRuns } = require('@/features/insights/lib/taskRunLog');
  const { cancelQueuedActivityPushes } = require('@/features/insights/lib/activityPushJobs');
  const { forgetActivityMapOverrides } = require('@/features/maps/stores/MapPreferencesContext');
  const { useNotificationPrompt } = require('@/features/settings/stores/NotificationPromptStore');
  const { useUploadPermissionStore } =
    require('@/features/recording') as typeof import('@/features/recording');

  const platformRecord = platformRecordUri();
  // Where the database is now, and Documents, where every build before the App
  // Group move kept it and so wrote its rollback and quarantined copies.
  const documents = FileSystem.documentDirectory?.replace(/^file:\/\//, '');
  const snapshotBeside = new Set([dbPath, documents ? `${documents}routes.db` : null]);
  await Promise.all([
    clearAllGpsTracks(),
    clearBoundsCache(),
    FileSystem.deleteAsync(ROUTE_NAMES_FILE, { idempotent: true }),
    platformRecord ? FileSystem.deleteAsync(platformRecord, { idempotent: true }) : undefined,
    deleteRecordTemporaries(),
    ...[...snapshotBeside].map((path) => (path ? deleteClearSnapshot(path) : undefined)),
    ...[...snapshotBeside].map((path) => (path ? deleteSetAsideCopies(path) : undefined)),
    ...[...snapshotBeside].map((path) => (path ? deletePanicLog(path) : undefined)),
    FileSystem.deleteAsync(LEGACY_HEATMAP_TILES_DIR, { idempotent: true }),
    clearTerrainPreviews(),
    clearBasemapTiles(),
    forgetPendingSnapshots(),
    forgetCameraOverrides(),
    forgetMapCameraState(),
    Promise.resolve(disconnectAllSensors())
      .catch(() => {})
      .then(() => forgetKnownSensors()),
    forgetActivityMapOverrides(),
    forgetTrackFetchDismissal(),
    clearTaskRuns(),
    clearCrashLog(),
    ...LEGACY_LIBRARY_KEYS.map((key) => removeSetting(key).catch(() => {})),
    forgetCachedAthleteId(),
    forgetStoredActivityCount(),
    forgetInsightFingerprint(),
    deleteBackupFiles(),
    deleteCachedAthleteFiles(),
    clearWebdavConfig(),
    clearPendingApiKey(),
    releasePushRegistration(),
  ]);
  // Once the token is released, so no push for this athlete lands after it.
  cancelQueuedActivityPushes();
  clearImageDiskCache();
  await dismissAllNotifications();
  // After the engine wipe, so no refresh can write the previous library back
  // once the snapshot is gone.
  clearWidgetSnapshot();
  // After the engine wipe, whose re-opened handle these settings go through.
  forgetBackupCarrier();
  useNotificationPreferences.getState().reset();
  useNotificationPrompt.getState().reset();
  useUploadPermissionStore.getState().reset();
  // The launch's Clear & Sync wipes for an athlete already signed in, and no
  // sign-in follows to answer the scope, so the store is loaded with no answer
  // and the screens ask for it rather than wait for ever.
  if (useAuthStore.getState().authMethod) useUploadPermissionStore.setState({ isLoaded: true });

  const { useInsightsStore } = require('@/features/insights/store');
  useInsightsStore.getState().reset();
}

/**
 * Full account-data wipe.
 *
 * Used for: explicit "Sign out and clear data", account-change confirmation
 * during login, and demo entry when leftover real-account data is detected.
 *
 * Clears:
 * - TanStack Query in-memory cache (via passed queryClient)
 * - The library, every file beside it and the backup carrier (`wipeLibrary`)
 *
 * Does NOT clear:
 * - AuthStore (caller handles this)
 * - SyncDateRangeStore (caller may want to reset separately)
 */
export async function clearAccountData(queryClient: { clear: () => void }): Promise<void> {
  queryClient.clear();

  await wipeLibrary();

  log.log('Cleared all app caches');
}

/**
 * Demo-mode cleanup.
 *
 * Used for: leaving demo mode via the "Tap to sign in" banner. The engine
 * only ever holds one identity at a time, so when this fires the engine
 * state IS the demo data - a full clearAccountData wipe is correct. The
 * dedicated alias documents intent at the call site and lets us swap in
 * a more selective implementation later if the engine ever supports
 * multi-account state.
 */
export async function clearDemoData(queryClient: { clear: () => void }): Promise<void> {
  await clearAccountData(queryClient);
}
