/** Record ZIP backup and conversion of earlier backup formats. */

import { RestoreRefusedError, type RestoreRefusal } from './restoreRefusal';
import type { RestoreDrops } from './restoreNotice';
import * as FileSystem from 'expo-file-system/legacy';
import { getEngine, getNativeModule, isEngineReady } from '@/shared/native/engine';
import { formatLocalDate } from '@/shared/format/format';
import { exportFileUri, restoreCopyUri } from '@/shared/storage/cacheFiles';
import { shareExistingFile, type ShareAnchor } from '@/features/settings/lib/shareFile';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';
import { sweepBackupFiles } from './backupCache';
import { SHARE_COPY_PREFIX } from '@/features/settings/lib/autobackup/backends/localBackend';
import { initialiseSportPreference } from '@/features/fitness';
import { initialiseDashboardPreferences } from '../stores/summaryCardPreferences';
import { initialiseInsightsStore } from '@/features/insights';
import {
  initialiseHeatmapPreference,
  initialiseTileCacheSettings,
  reloadCameraOverrides,
  reloadMapCameraState,
} from '@/features/maps';
import { initialiseRecordingPreferences, initialiseUploadPermission } from '@/features/recording';
import { initialiseKnownSensors } from '@/features/sensors';
import { initialiseRouteSettings } from '@/features/routes';
import { initialiseDebugStore } from '@/features/settings/stores/DebugStore';
import { initialiseNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { initialiseNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { initialiseSupportStore } from '@/shared/app/SupportStore';
import { initialiseWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { initialiseLanguage } from '@/shared/app/LanguageStore';
import { initialiseTheme } from '@/shared/app/ThemeProvider';
import { initialiseUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { z } from 'zod';
import { debug } from '@/shared/debug/debug';
import { queryClient } from '@/shared/query/QueryProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';

const log = debug.create('Backup');

/**
 * What a caller staring at a disabled row waits for the record export.
 *
 * The write is over a second on a full library, so this is sixty times a
 * healthy run. Past it the athlete is told the export is still running rather
 * than told it failed.
 */
export const FOREGROUND_BACKUP_TIMEOUT_MS = 60_000;

/** A record export whose wait lapsed, kept until its write ends and its file is offered. */
interface PendingRecordExport {
  readonly uri: string;
  readonly work: Promise<void>;
  settled(): boolean;
  failure(): Error | null;
}

let pendingExport: PendingRecordExport | null = null;

export type RecordExportOutcome = 'complete' | 'still-running' | 'nothing-pending';

/** Write the record zip, once the slot is free, and return the file it wrote. */
async function writeRecordArchive(
  engine: NonNullable<ReturnType<typeof getEngine>>
): Promise<string> {
  await sweepBackupFiles();
  const uri = await exportFileUri(`${SHARE_COPY_PREFIX}${formatLocalDate(new Date())}.zip`);
  const path = uri.startsWith('file://') ? uri.slice(7) : uri;
  await engine.runRecordBackup(path);
  return uri;
}

/**
 * Write the record zip and offer that same file to the share sheet.
 *
 * The wait, the queue behind another backup write included, has the
 * foreground ceiling. Past it this answers `still-running` and the file is
 * offered by `resumePendingRecordExport` once the write has ended.
 */
export async function exportRecordBackup(anchor?: ShareAnchor): Promise<RecordExportOutcome> {
  if (pendingExport) return resumePendingRecordExport(anchor);
  const engine = getEngine();
  if (!engine) throw new Error('Engine not initialised');

  let uri = '';
  let lapsed = false;
  let sharing = false;
  let settled = false;
  let failure: Error | null = null;
  const work = inBackupSlot(async () => {
    uri = await writeRecordArchive(engine);
    // The slot is held through the share so a sweep cannot delete the file
    // under the open sheet. A lapsed export is shared by its reader later.
    if (lapsed) return;
    sharing = true;
    await shareExistingFile(uri, 'zip', { anchor });
  }).then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      settled = true;
      failure = err instanceof Error ? err : new Error(String(err));
      throw failure;
    }
  );
  work.catch(() => {});

  const outcome = await withAwakeDeadline(work, FOREGROUND_BACKUP_TIMEOUT_MS);
  // A sheet left open past the ceiling is the athlete's own wait, not a write owed.
  if (outcome.state === 'stillRunning' && !sharing) {
    lapsed = true;
    pendingExport = {
      get uri() {
        return uri;
      },
      work,
      settled: () => settled,
      failure: () => failure,
    };
    return 'still-running';
  }
  return 'complete';
}

/** Whether a lapsed export still owes its file. */
export function hasPendingRecordExport(): boolean {
  return pendingExport !== null;
}

/**
 * Settles when the lapsed write ends, either way, or at once when none is
 * owed. It never rejects and claims nothing: the reader that is still there
 * afterwards takes the file with `resumePendingRecordExport`.
 */
export function pendingRecordExportSettled(): Promise<void> {
  const owed = pendingExport;
  if (!owed) return Promise.resolve();
  return owed.work.then(
    () => undefined,
    () => undefined
  );
}

/**
 * Offer the file a lapsed export left behind, once its write has finished.
 * A write still going stays owed. One that ended is taken before anything else,
 * so only the first reader shares it or reports its failure.
 */
export async function resumePendingRecordExport(
  anchor?: ShareAnchor
): Promise<RecordExportOutcome> {
  const owed = pendingExport;
  if (!owed) return 'nothing-pending';
  if (!owed.settled()) return 'still-running';
  pendingExport = null;
  const failure = owed.failure();
  if (failure) throw failure;
  await shareExistingFile(owed.uri, 'zip', { anchor });
  return 'complete';
}

let restoreCopySequence = 0;

interface RecordRestoreOutcome extends RestoreDrops {
  placed: number;
  unplaced: number;
  missingActivityIds: string[];
}

/**
 * Hand the activities a restored record names to the sync.
 *
 * The engine keeps the ids it still owes and every sync fetches them as its
 * own step, with progress in the sync status. So the import does not wait on
 * the network, and an import made offline or killed part way resumes at the
 * next sync. A sync already running reaches that step on its own.
 */
function requestRecordActivities(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  restored: RecordRestoreOutcome
): void {
  if (restored.missingActivityIds.length === 0) return;
  try {
    engine.syncNow(false);
  } catch (error) {
    log.warn('Record source fetch left for the next sync:', error);
  }
}

/** Keep preferences needed without an open engine in step with restored SQLite settings. */
async function mirrorRestoredPreferences(
  engine: NonNullable<ReturnType<typeof getEngine>>
): Promise<void> {
  for (const key of [
    'veloq-theme-preference',
    'veloq-language-preference',
    'veloq-notification-preferences',
  ]) {
    const value = engine.getSetting(key);
    if (value !== undefined && value !== null) {
      try {
        await AsyncStorage.setItem(key, value);
      } catch (error) {
        log.warn(`Could not mirror restored ${key}:`, error);
      }
    }
  }
}

/** The engine is closed, so an import has nowhere to go until the athlete signs in. */
export class SignInRequiredError extends RestoreRefusedError {
  constructor() {
    super('signInRequired');
    this.name = 'SignInRequiredError';
  }
}

function openEngineForImport(): NonNullable<ReturnType<typeof getEngine>> {
  const engine = getEngine();
  if (!engine || !isEngineReady()) throw new SignInRequiredError();
  return engine;
}

/** What the engine read from a backup that it found nothing to refuse in. */
export interface RestoreCheck {
  /** When the backup was written, as an ISO string, or null for one that names no time. */
  writtenAt: string | null;
  /** Whether the backup names this account. One naming another account is refused. */
  namesAccount: boolean;
  names: number;
  settings: number;
  decisions: number;
}

function restoreCheck(check: Awaited<ReturnType<RecordEngine['checkRecordZip']>>): RestoreCheck {
  return { ...check, writtenAt: check.writtenAt ?? null };
}

type RecordEngine = ReturnType<typeof openEngineForImport>;

/**
 * Run the checks `restoreRecordBackup` would run on a record zip, and restore
 * nothing. Rejects with the restore's own refusal.
 */
export async function checkRecordBackup(fileUri: string): Promise<RestoreCheck> {
  const engine = openEngineForImport();
  return restoreCheck(
    await engine.checkRecordZip(fileUri.startsWith('file://') ? fileUri.slice(7) : fileUri)
  );
}

/**
 * Run the checks `restoreBackup` would run on a `.veloq` file's text, and
 * restore nothing. Rejects for a file that does not convert, or with the
 * restore's own refusal.
 */
export async function checkLegacyBackup(json: string): Promise<RestoreCheck> {
  const record = convertLegacyBackupToRecord(json);
  const engine = openEngineForImport();
  return restoreCheck(await engine.checkRecordJson(JSON.stringify(record)));
}

/** Import a picked record zip through the engine's versioned restore path. */
export async function restoreRecordBackup(fileUri: string): Promise<RecordRestoreOutcome> {
  const engine = openEngineForImport();
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || info.size === 0) throw new RestoreRefusedError('missing');

  const copyUri = await restoreCopyUri(`restore-record-${Date.now()}-${++restoreCopySequence}.zip`);
  try {
    await FileSystem.copyAsync({ from: fileUri, to: copyUri });
    const path = copyUri.startsWith('file://') ? copyUri.slice(7) : copyUri;
    const result = await engine.restoreRecordZip(path);
    requestRecordActivities(engine, result);
    await mirrorRestoredPreferences(engine);
    await reinitialiseAllStores();
    await queryClient.invalidateQueries();
    return result;
  } finally {
    await FileSystem.deleteAsync(copyUri, { idempotent: true }).catch(() => {});
  }
}

const EMPTY_RECORD: RecordPayload = { version: 1, athlete_id: null, entries: [] };

/**
 * Place the import a storage failure or a killed process paused, then reload
 * the stores from the engine. Resolves null when the engine is closed or
 * nothing is paused, and rejects when the import stays paused.
 */
export async function resumeRecordImport(): Promise<RecordRestoreOutcome | null> {
  const engine = getEngine();
  if (!engine || !isEngineReady()) return null;
  const waiting = await engine.getUnplacedBackupRecords();
  if (!waiting.some((record) => record.reason === 'import_paused')) return null;
  // An import of no entries carries the paused one, under the same checks.
  const restored = await engine.restoreRecordJson(JSON.stringify(EMPTY_RECORD));
  requestRecordActivities(engine, restored);
  await mirrorRestoredPreferences(engine);
  await reinitialiseAllStores();
  await queryClient.invalidateQueries();
  return restored;
}

/**
 * Drop the paused import at the athlete's word. Nothing from it was applied,
 * so there is nothing to reload. Rejects when the engine is closed, since a
 * discard that did not happen must not read as done.
 */
export async function discardRecordImport(): Promise<void> {
  const engine = getEngine();
  if (!engine || !isEngineReady()) throw new Error('Engine not initialised');
  await engine.discardRecordImport();
}

/**
 * Drop what an import left waiting at the athlete's word, keeping what was
 * placed. Rejects when the engine is closed, as a discard that did not happen
 * must not read as done.
 */
export async function discardUnplacedRecords(): Promise<void> {
  const engine = getEngine();
  if (!engine || !isEngineReady()) throw new Error('Engine not initialised');
  await engine.discardUnplacedBackupRecords();
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Read when a reload runs, not when this module loads: the feature barrels this
 * table names import the settings barrel back, so a table built at load reads
 * their exports before they exist.
 */
const storeInitialisers = (): readonly (readonly [string, () => Promise<unknown>])[] => [
  ['initialiseTheme', initialiseTheme],
  ['initialiseLanguage', initialiseLanguage],
  ['initialiseSportPreference', initialiseSportPreference],
  ['initialiseUnitPreference', initialiseUnitPreference],
  ['initialiseRouteSettings', initialiseRouteSettings],
  ['initialiseHeatmapPreference', initialiseHeatmapPreference],
  ['initialiseDashboardPreferences', initialiseDashboardPreferences],
  ['initialiseDebugStore', initialiseDebugStore],
  ['initialiseTileCacheSettings', initialiseTileCacheSettings],
  ['initialiseWhatsNewStore', initialiseWhatsNewStore],
  ['initialiseInsightsStore', initialiseInsightsStore],
  ['initialiseRecordingPreferences', initialiseRecordingPreferences],
  ['initialiseKnownSensors', initialiseKnownSensors],
  ['initialiseUploadPermission', initialiseUploadPermission],
  ['initialiseNotificationPreferences', initialiseNotificationPreferences],
  ['initialiseNotificationPrompt', initialiseNotificationPrompt],
  ['initialiseSupportStore', initialiseSupportStore],
  ['reloadCameraOverrides', reloadCameraOverrides],
  ['reloadMapCameraState', reloadMapCameraState],
];

/**
 * Reinitialise all Zustand stores from storage (SQLite + AsyncStorage).
 *
 * Settled, not all: one store failing to load must not leave the rest on
 * pre-restore state.
 */
export async function reinitialiseAllStores(): Promise<void> {
  const initialisers = storeInitialisers();
  const results = await Promise.allSettled(initialisers.map(([, init]) => init()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      log.error(`${initialisers[index][0]} failed`, result.reason);
    }
  });
}

export type DatabaseRestoreResult =
  | { success: true; unplacedCount: number; drops: RestoreDrops }
  | {
      success: false;
      /** Why nothing went in, for the caller to word in the athlete's locale. */
      refusal?: RestoreRefusal;
    };

/**
 * Write the record zip an older SQLite file converts to at `recordUri`.
 *
 * The converter migrates its input, so it reads a copy beside `recordUri`, a
 * `.zip` name, and the picked file is left as it was. Rejects with the
 * converter's refusal for a file it cannot read.
 */
export async function convertLegacyDatabaseFile(fileUri: string, recordUri: string): Promise<void> {
  const nativeModule = getNativeModule();
  if (!nativeModule) throw new RestoreRefusedError('unavailable');
  const copyUri = recordUri.replace(/\.zip$/, '.veloqdb');
  try {
    await FileSystem.copyAsync({ from: fileUri, to: copyUri });
    const sourcePath = copyUri.startsWith('file://') ? copyUri.slice(7) : copyUri;
    const recordPath = recordUri.startsWith('file://') ? recordUri.slice(7) : recordUri;
    await nativeModule.convertLegacyDatabaseToRecordBackup(sourcePath, recordPath);
  } finally {
    await FileSystem.deleteAsync(copyUri, { idempotent: true }).catch(() => {});
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
 * onto another install): 'veloq-query-cache', 'terrain-preview-cache-version', 'veloq-recording-library' (the pre-table
 * index, points at local FIT files that are not in the backup),
 * 'veloq-section-health-check-v1',
 * 'veloq-push-token-refreshed-at' (device-local refresh throttle; restoring a
 * stale timestamp could suppress a needed re-registration for a day). A
 * stale timestamp must not move to another install.
 * 'veloq-upload-permission' is the scope of this install's OAuth token, which
 * only the server that granted it can state, so a restore keeps the one here.
 * Also excluded because nothing reads them any more: 'veloq-section-dismissals',
 * 'veloq-geocoded-route-ids' and 'veloq-geocoded-section-ids'.
 * 'veloq-disabled-sections' and 'veloq-superseded-sections' are not settings
 * rows either: each id converts to its own unplaced record below.
 */
const LEGACY_PREFERENCE_KEYS = [
  'veloq-theme-preference',
  'veloq-language-preference',
  'veloq-unit-preference',
  'veloq-primary-sport',
  'veloq-map-preferences',
  'veloq-route-settings',
  'veloq-debug-mode',
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
  'veloq-notification-preferences',
  'veloq-support-store',
] as const;

interface RecordEntry {
  table: string;
  values: Record<string, unknown>;
  ground: {
    rep_activity_id: string | null;
    rep_start_index: number | null;
    rep_end_index: number | null;
    point_count: number | null;
    polyline_json: string | null;
    /** A route's member rides, which the restore finds the local route by. */
    activity_ids?: string[];
  } | null;
}

interface RecordPayload {
  version: number;
  athlete_id: string | null;
  entries: RecordEntry[];
}

const legacyCustomSectionSchema = z.object({
  name: z.string(),
  sportType: z.string(),
  sourceActivityId: z.string().min(1),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().positive(),
});

const legacyBackupSchema = z.object({
  version: z.number().int().min(1),
  customSections: z.array(legacyCustomSectionSchema).optional(),
  sectionNames: z.record(z.string(), z.string()).optional(),
  routeNames: z.record(z.string(), z.string()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The old per-section lists. Auto section ids are positional, so an id names
 * unrelated ground in another library: each travels as its own unplaced record.
 */
const LEGACY_SECTION_STATE_TABLES = [
  ['veloq-disabled-sections', 'legacy_section_disabled'],
  ['veloq-superseded-sections', 'legacy_section_superseded'],
] as const;

/** The ids of one old list, held as a JSON string or an array. Unreadable lists carry none. */
function legacyIdList(value: unknown): string[] {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
      // empty-on-error: an unreadable legacy list is a stored string, not an engine read, and carries no ids
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((id): id is string => typeof id === 'string' && id !== '');
}

/** The suffix the old grouping gave a route split off another route's ride. */
const LEGACY_SPLIT_ROUTE_SUFFIX = '_split';

/** Convert a readable `.veloq` file into the record restore's input. */
export function convertLegacyBackupToRecord(json: string): RecordPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup file format');
  }
  const envelope = z.object({ version: z.number() }).safeParse(parsed);
  if (!envelope.success) throw new Error('Corrupt backup: missing version field');
  if (envelope.data.version > LEGACY_BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version: ${envelope.data.version}. This app supports version ${LEGACY_BACKUP_VERSION}.`
    );
  }
  const checked = legacyBackupSchema.safeParse(parsed);
  if (!checked.success) throw new Error('Corrupt backup: invalid decisions');

  const backup = checked.data;
  const entries: RecordEntry[] = [];
  for (const section of backup.customSections ?? []) {
    if (section.startIndex >= section.endIndex) {
      throw new Error('Corrupt backup: invalid section range');
    }
    entries.push({
      table: 'sections',
      values: {
        name: section.name || null,
        sport_type: section.sportType,
        section_type: 'custom',
        source_activity_id: section.sourceActivityId,
        start_index: section.startIndex,
        end_index: section.endIndex,
      },
      // The old writer exported the last point's index; the ground's end is half-open.
      ground: {
        rep_activity_id: section.sourceActivityId,
        rep_start_index: section.startIndex,
        rep_end_index: section.endIndex + 1,
        point_count: null,
        polyline_json: null,
      },
    });
  }
  for (const [id, name] of Object.entries(backup.sectionNames ?? {})) {
    entries.push({ table: 'legacy_section_name', values: { section_id: id, name }, ground: null });
  }
  // An old route id is the id of a ride in that route, so the name is placed
  // by the local route holding that ride. A split's id names a ride of the
  // route it split from, so a split name carries no ground and stays unplaced.
  for (const [routeId, customName] of Object.entries(backup.routeNames ?? {})) {
    entries.push({
      table: 'route_names',
      values: { route_id: routeId, custom_name: customName },
      ground: routeId.endsWith(LEGACY_SPLIT_ROUTE_SUFFIX)
        ? null
        : {
            rep_activity_id: routeId,
            activity_ids: [routeId],
            rep_start_index: null,
            rep_end_index: null,
            point_count: null,
            polyline_json: null,
          },
    });
  }
  for (const [key, table] of LEGACY_SECTION_STATE_TABLES) {
    for (const id of legacyIdList(backup.preferences?.[key])) {
      entries.push({ table, values: { section_id: id }, ground: null });
    }
  }
  const allowed = new Set<string>(LEGACY_PREFERENCE_KEYS);
  for (const [key, value] of Object.entries(backup.preferences ?? {})) {
    if (!allowed.has(key)) continue;
    entries.push({
      table: 'settings',
      values: { key, value: typeof value === 'string' ? value : JSON.stringify(value) },
      ground: null,
    });
  }
  return { version: 1, athlete_id: null, entries };
}

export type RestoreResult =
  | { unplacedCount: number; drops: RestoreDrops }
  | {
      /** Why nothing went in, for the caller to word in the athlete's locale. */
      refusal: RestoreRefusal;
    };

/** Whether an import has to wait for a sign-in: a closed engine places no record. */
export function importWaitsForSignIn(): boolean {
  return !getEngine() || !isEngineReady();
}

export async function restoreBackup(json: string): Promise<RestoreResult> {
  const record = convertLegacyBackupToRecord(json);
  const engine = getEngine();
  if (!engine || importWaitsForSignIn()) {
    return { refusal: 'signInRequired' };
  }
  const restored = await engine.restoreRecordJson(JSON.stringify(record));
  requestRecordActivities(engine, restored);
  await mirrorRestoredPreferences(engine);
  await reinitialiseAllStores();
  await queryClient.invalidateQueries();
  return { unplacedCount: restored.unplaced, drops: restored };
}
