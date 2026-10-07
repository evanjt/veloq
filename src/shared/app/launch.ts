import { initializeSportPreference } from '@/features/fitness/stores';
import { initializeDashboardPreferences } from '@/features/home/store';
import { initializeInsightsStore } from '@/features/insights/store';
import {
  handOverGroundTemplates,
  initializeHeatmapPreference,
  initializeTileCacheSettings,
} from '@/features/maps';
import { initializeRecordingPreferences, initializeUploadPermission } from '@/features/recording';
import { initializeRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';
import { initializeNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initializeNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initializeWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { initializeLanguage } from '@/shared/app/LanguageStore';
import { initializeSupportStore } from '@/shared/app/SupportStore';
import { loadTrackFetchNotice } from '@/features/routes';
import { initializeTheme } from '@/shared/app/ThemeProvider';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';
import * as FileSystem from 'expo-file-system/legacy';

import { basemapStore } from 'veloqrs';

import { excludeExistingFromBackup, excludeFromBackup } from '@/shared/native/backupExclusion';
import {
  TERRAIN_PREVIEW_DIR,
  discardLegacyTerrainPreviews,
} from '@/shared/storage/terrainPreviewRoot';
import { openLibrary, routeDbFilePaths } from '@/shared/storage/routeDbLocation';
import { getEngine, getRouteDbPath, resolveRouteDbPath } from '@/shared/native/engine';
import {
  captureQuarantineReport,
  excludeLocalBackupsFromDeviceBackup,
  cleanUpRetiredBackupSettings,
  resumeRecordImport,
  sweepIdleBackupFiles,
} from '@/features/settings';
import { initializeI18n } from '@/i18n';
import { pushNotificationTemplates } from '@/i18n/notificationTemplates';
import type { StartupArea } from '@/shared/ui/StartupErrorBanner';

/** A `launch:` mark survives a release build, so a trace can split the JS window. */
function markLaunch(step: 'auth' | 'engine' | 'stores'): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(`launch:${step}`);
  }
}

/**
 * Open the library before the stores read their settings, so every read is
 * one SQLite lookup instead of a round trip to AsyncStorage. A launch with no
 * credentials leaves the engine closed, as the login screen expects. Failure
 * is left to `AuthGate`, which retries and raises the banner.
 */
function openEngine(): void {
  if (!useAuthStore.getState().isAuthenticated) return;
  const engine = getEngine();
  const dbPath = getRouteDbPath();
  if (!engine || !dbPath) return;
  if (openLibrary(engine, dbPath)) captureQuarantineReport();
}

/**
 * Keep the library database and its journal files out of the device backup.
 *
 * Every launch, for a library already on disk with nobody signed in, which
 * `openLibrary` never opens. A library opened later is marked by `openLibrary`
 * itself. Only the files, not their directory: the widget snapshot and
 * the notification extension write beside them.
 */
function excludeDatabaseFromDeviceBackup(): void {
  const dbPath = getRouteDbPath();
  if (!dbPath) return;
  for (const file of routeDbFilePaths(dbPath)) {
    if (excludeExistingFromBackup(file) === false) {
      console.warn(`[launch] ${file} is not excluded from the device backup`);
    }
  }
}

/**
 * Hand the basemap tile store its directory.
 *
 * The documents directory, not the cache: a basemap tile is fetched from a
 * third party and cannot be redrawn from local data, so a purge costs the
 * athlete the offline map. Independent of the engine, which the store never
 * needs.
 */
function openBasemapStore(): void {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return;
  const plain = docDir.startsWith('file://') ? docDir.slice(7) : docDir;
  const path = `${plain}basemap-tiles`;
  try {
    basemapStore().setPath(path);
  } catch (reason) {
    console.warn('[launch] basemap tile store stayed closed:', errorMessage(reason));
    return;
  }
  // Before any map page is built, because the pre-seed runs off a sync and a
  // fresh install can sync and lose the radio without a map ever being opened.
  handOverGroundTemplates();
  // Every launch, not once: the store creates the directory on first use and
  // a cache clear makes a new one, and the attribute lives on the directory.
  if (excludeFromBackup(path) === false) {
    console.warn('[launch] basemap tile tree is not excluded from the device backup');
  }
}

/**
 * Keep the terrain previews out of the device backup, and clear the root they
 * used to live under.
 *
 * Every launch, because the attribute lives on the directory and one made by an
 * earlier build never asked for it. The cache asks again whenever it makes the
 * directory itself, after a clear. The previews redraw from local data, so an
 * iCloud backup carrying 150 JPEGs of them is pure cost.
 */
function openTerrainPreviews(): void {
  const plain = TERRAIN_PREVIEW_DIR.startsWith('file://')
    ? TERRAIN_PREVIEW_DIR.slice(7)
    : TERRAIN_PREVIEW_DIR;
  if (excludeFromBackup(plain) === false) {
    console.warn('[launch] terrain previews are not excluded from the device backup');
  }
  // Fire and forget: a directory a previous build filled is not something the
  // first screen waits on.
  void discardLegacyTerrainPreviews();
}

/**
 * Finish a record import a storage failure or a killed process paused. After
 * the stores, which it reloads once the import lands, and not awaited: the
 * first screen does not wait on it, and one that cannot land yet stays paused
 * behind Try again in backup settings.
 */
function resumePausedImport(): void {
  resumeRecordImport().catch((reason) => {
    console.warn('[launch] paused record import stays paused:', errorMessage(reason));
  });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? 'Unknown startup error');
}

/**
 * Restore every store the first screen reads. Resolves to the areas whose
 * initialiser rejected, each once and in launch order, or null when all of them
 * settled. The engine's message is logged and never returned: it is English and
 * in the engine's vocabulary, and the banner reads a translated line per area.
 */
export async function initializeApp(): Promise<StartupArea[] | null> {
  markLaunch('auth');
  await useAuthStore.getState().initialize();
  markLaunch('engine');
  // Before the engine, never after: the move is only a consistent snapshot of
  // the database and its journal while no connection is open.
  await resolveRouteDbPath();
  openEngine();
  excludeDatabaseFromDeviceBackup();
  openBasemapStore();
  openTerrainPreviews();
  // Whether or not anyone is signed in: the backups outlive a sign-out.
  excludeLocalBackupsFromDeviceBackup();
  cleanUpRetiredBackupSettings();
  void sweepIdleBackupFiles().catch((reason) => {
    console.warn('[launch] backup cache sweep failed:', errorMessage(reason));
  });
  markLaunch('stores');
  const initialisers: [StartupArea, Promise<unknown>][] = [
    ['language', initializeLanguage().then(initializeI18n).then(pushNotificationTemplates)],
    ['preferences', initializeTheme()],
    ['preferences', initializeSportPreference()],
    ['preferences', initializeUnitPreference()],
    ['routes', initializeRouteSettings()],
    ['preferences', initializeHeatmapPreference()],
    ['preferences', initializeDashboardPreferences()],
    ['other', initializeDebugStore()],
    ['maps', initializeTileCacheSettings()],
    ['other', initializeWhatsNewStore()],
    ['insights', initializeInsightsStore()],
    ['recording', initializeRecordingPreferences()],
    ['recording', initializeUploadPermission()],
    ['notifications', initializeNotificationPreferences()],
    ['notifications', initializeNotificationPrompt()],
    ['other', initializeSupportStore()],
    ['other', loadTrackFetchNotice()],
  ];
  const results = await Promise.allSettled(initialisers.map(([, started]) => started));
  resumePausedImport();
  const areas: StartupArea[] = [];
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const area = initialisers[index][0];
    console.warn(`[AppInit] ${area} initialiser failed:`, errorMessage(result.reason));
    if (!areas.includes(area)) areas.push(area);
  });
  return areas.length === 0 ? null : areas;
}
