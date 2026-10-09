/**
 * Auto-backup orchestration.
 *
 * Creates the record archive, hands it to every carrier the athlete has set
 * up and reads each copy back before counting it as a backup. Handles
 * scheduling (throttled to once per 24h). Nothing is deleted on a carrier, so
 * storage there is the athlete's to manage.
 *
 * Triggers:
 * 1. After sync completion (new data arrived)
 * 2. App backgrounding (if last backup > 24h)
 * 3. App foregrounding (if last backup > 7d)
 * 4. Reconnecting, which only sends a copy a carrier is still owed
 *
 * A copy a carrier could not take for a reason that passes, a dead radio or a
 * server that did not answer, is owed. Every trigger sends it to that carrier
 * once the radio is up, whether or not automatic backup is on, because the
 * athlete asked for it with Back Up Now or the schedule did.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import Constants from 'expo-constants';
import type { FfiUnplacedRecord } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { platformRecordUri } from '@/shared/storage/platformRecord';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';
import { debug } from '@/shared/debug/debug';
import type { BackupBackend, BackupEntry } from './backends/types';
import { backupCarriers } from './backends/carriers';
import { forgetBackupFolder } from './backends/folderBackend';
import {
  BackupTransferError,
  isBackupTransferError,
  type BackupFailureKind,
} from './backends/errors';
import { getWebdavConfig } from './webdavConfig';
import { zipFingerprint, type ZipFingerprint } from './zipFingerprint';
import { heldBackupFolder } from '@/shared/native/backupFolder';
import { readBackCopyUri } from '@/shared/storage/cacheFiles';
import { TIME } from '@/shared/app/time';

const log = debug.create('AutoBackup');
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

const SETTING_LAST_BACKUP = '__last_auto_backup';
/** Retired: the carrier set replaced the single chosen backend. */
const SETTING_RETIRED_BACKEND_ID = '__backup_backend';
const SETTING_AUTO_BACKUP_ENABLED = '__auto_backup_enabled';
// Diagnostic state rather than a preference, so deliberately not in PREFERENCE_KEYS
const SETTING_LAST_FAILURE = '__last_backup_failure';
/**
 * When each destination last took a backup, and which server or folder that
 * was. A carrier's stamp is the time its copy read back the same as the zip.
 */
const SETTING_DESTINATION_STAMPS = '__last_backup_by_destination';
/** Set once the platform zip is this library's own, or its offer was answered. */
const SETTING_PLATFORM_RECORD_ANSWERED = '__platform_record_answered';
/** The carrier ids still owed the last zip, as a JSON array. */
const SETTING_OWED_CARRIERS = '__backup_owed_carriers';

const MIN_INTERVAL_MS = TIME.DAY; // 24 hours
const STALE_INTERVAL_MS = 7 * TIME.DAY; // 7 days

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

/**
 * Drop the setting the single chosen backend lived in. The switch, the stamp
 * and any WebDAV configuration stay as the athlete left them, and the files
 * the old local backend wrote are left alone.
 */
export function cleanUpRetiredBackupSettings(): void {
  getEngine()?.deleteSetting(SETTING_RETIRED_BACKEND_ID);
}

/**
 * Forget the carriers, the toggle, the last run and the last failure.
 *
 * The engine's wipe keeps its settings on purpose, so without this the next
 * athlete inherits the previous one's WebDAV choice or folder with auto-backup
 * on, and their first sync writes their record there. The zips already in the
 * folder stay: the folder is the athlete's own storage.
 */
export function forgetBackupCarrier(): void {
  const engine = getEngine();
  for (const key of [
    SETTING_RETIRED_BACKEND_ID,
    SETTING_AUTO_BACKUP_ENABLED,
    SETTING_LAST_BACKUP,
    SETTING_LAST_FAILURE,
    SETTING_OWED_CARRIERS,
    SETTING_DESTINATION_STAMPS,
  ]) {
    engine?.deleteSetting(key);
  }
  forgetBackupFolder();
}

/** Whether the platform zip needs no offer on this library. */
export function isPlatformRecordAnswered(): boolean {
  return getEngine()?.getSetting(SETTING_PLATFORM_RECORD_ANSWERED) === '1';
}

/** Record that the zip in the documents directory needs no offer. */
export function markPlatformRecordAnswered(): void {
  getEngine()?.setSetting(SETTING_PLATFORM_RECORD_ANSWERED, '1');
}

/** Get timestamp of the last auto-backup, or null if never. */
export function getLastBackupTimestamp(): number | null {
  const engine = getEngine();
  const value = engine?.getSetting(SETTING_LAST_BACKUP);
  return value != null ? Number(value) : null;
}

/** A place a run writes to: the device backup's zip, or one of the carriers. */
export type BackupDestination = 'device' | 'webdav' | 'folder';

interface DestinationStamp {
  at: number;
  to: string;
}

/**
 * The server or folder a destination writes to now, or null when it is not set
 * up. A stamp is shown only while this still matches, so a new server or folder
 * starts with no date rather than the old one's.
 */
function destinationTarget(id: string): string | null {
  switch (id) {
    case 'device':
      return 'device';
    case 'webdav':
      return getWebdavConfig()?.url ?? null;
    case 'folder':
      return heldBackupFolder();
    default:
      return null;
  }
}

function readDestinationStamps(): Record<string, DestinationStamp> {
  const raw = getEngine()?.getSetting(SETTING_DESTINATION_STAMPS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, DestinationStamp>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function stampDestination(id: string, at: number): void {
  const to = destinationTarget(id);
  if (to === null) return;
  getEngine()?.setSetting(
    SETTING_DESTINATION_STAMPS,
    JSON.stringify({ ...readDestinationStamps(), [id]: { at, to } })
  );
}

/** When this destination, as it is set up now, last took a backup, or null. */
export function getDestinationLastBackup(id: BackupDestination): number | null {
  const stamp = readDestinationStamps()[id];
  const to = destinationTarget(id);
  if (!stamp || to === null || stamp.to !== to || typeof stamp.at !== 'number') return null;
  return stamp.at;
}

/** Read records awaiting a matching activity or ground for the backup screen. */
export async function getUnplacedBackupRecords(): Promise<FfiUnplacedRecord[]> {
  const engine = getEngine();
  return engine ? engine.getUnplacedBackupRecords() : [];
}

export interface BackupFailure {
  kind: BackupFailureKind;
  status: number | null;
  /** Epoch millis of the attempt */
  at: number;
}

/**
 * The failures that need the user to act, by carrier id.
 *
 * Only permanent failures are kept. A backup that lost the network will be
 * retried without anyone doing anything, so standing text about it would be
 * noise rather than information.
 */
export function getBackupFailures(): Record<string, BackupFailure> {
  const raw = getEngine()?.getSetting(SETTING_LAST_FAILURE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, BackupFailure>;
    const failures: Record<string, BackupFailure> = {};
    for (const [id, failure] of Object.entries(parsed ?? {})) {
      if (typeof failure?.kind === 'string') failures[id] = failure;
    }
    return failures;
  } catch {
    return {};
  }
}

/** The most recent failure across carriers, or null. */
export function getLastBackupFailure(): BackupFailure | null {
  const all = Object.values(getBackupFailures());
  if (all.length === 0) return null;
  return all.reduce((latest, next) => (next.at > latest.at ? next : latest));
}

function writeBackupFailures(failures: Record<string, BackupFailure>): void {
  getEngine()?.setSetting(
    SETTING_LAST_FAILURE,
    Object.keys(failures).length === 0 ? '' : JSON.stringify(failures)
  );
}

function clearBackupFailure(carrierId: string): void {
  const failures = getBackupFailures();
  if (!(carrierId in failures)) return;
  delete failures[carrierId];
  writeBackupFailures(failures);
}

function recordBackupFailure(carrierId: string, error: unknown): void {
  if (!isBackupTransferError(error) || !error.permanent) return;
  writeBackupFailures({
    ...getBackupFailures(),
    [carrierId]: { kind: error.kind, status: error.status, at: Date.now() },
  });
}

/** The carriers a run could not hand the zip to for a reason that passes. */
function getOwedCarriers(): string[] {
  const raw = getEngine()?.getSetting(SETTING_OWED_CARRIERS);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeOwedCarriers(ids: string[]): void {
  const value = ids.length === 0 ? '' : JSON.stringify(ids);
  const engine = getEngine();
  if ((engine?.getSetting(SETTING_OWED_CARRIERS) ?? '') === value) return;
  engine?.setSetting(SETTING_OWED_CARRIERS, value);
}

/** Whether the automatic schedule is due a run. */
function isScheduledBackupDue(): boolean {
  if (!isAutoBackupEnabled()) return false;

  const lastBackup = getLastBackupTimestamp();
  if (!lastBackup) return true; // Never backed up

  return Date.now() - lastBackup >= MIN_INTERVAL_MS;
}

/**
 * Which carriers a run hands the zip to: every one, only the owed ones, or
 * none when the run is skipped.
 *
 * Back Up Now and a due schedule reach every carrier. Otherwise a run only
 * pays what is owed, and only once the radio is up, so a trigger while the
 * device is offline writes no archive.
 */
async function carriersToRun(force: boolean): Promise<'all' | Set<string> | null> {
  if (force || isScheduledBackupDue()) return 'all';
  const owed = getOwedCarriers();
  if (owed.length === 0 || !(await isRadioUp())) return null;
  return new Set(owed);
}

/** What one carrier did in a run. */
export type CarrierOutcome =
  | { status: 'written' }
  | { status: 'skipped'; reason: 'unavailable' | 'no-radio' }
  | { status: 'failed'; kind: BackupFailureKind | 'unknown' };

/** What a run did: whether the platform zip was written, and each carrier by id. */
export interface BackupRunResult {
  wroteZip: boolean;
  carriers: Record<string, CarrierOutcome>;
}

const NOTHING_WRITTEN: BackupRunResult = { wroteZip: false, carriers: {} };

/**
 * The backup this process is already doing, if any.
 *
 * Four triggers reach here, a settled sync, a backgrounding, a foreground and
 * a reconnect, and two of them can arrive a second apart. The last-backup stamp
 * and the owed carriers are not written until the carriers have been tried, so
 * both would pass `carriersToRun` and both would ask Rust for an archive. Rust
 * holds one backup handle and refuses the second outright. The second caller
 * joins the first instead.
 */
let inFlight: Promise<BackupRunResult> | null = null;

/**
 * Write the record archive and hand it to every available carrier.
 * A run that is skipped resolves with nothing written.
 */
export async function performBackup(force = false): Promise<BackupRunResult> {
  if (inFlight) return inFlight;
  inFlight = runBackupOnce(force).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runBackupOnce(force: boolean): Promise<BackupRunResult> {
  const engine = getEngine();
  if (!engine) return NOTHING_WRITTEN;

  // Read before the first await, so a wipe while the run is choosing its
  // carriers already counts as a move.
  const install = engine.engineInstall();
  // A read that fails cannot say this is still the library the backup started
  // on, so it counts as moved and nothing more is written or uploaded.
  const libraryMoved = (): boolean => {
    try {
      return engine.engineInstall() !== install;
    } catch {
      return true;
    }
  };

  const targets = await carriersToRun(force);
  if (!targets || libraryMoved()) return NOTHING_WRITTEN;

  const recordPath = platformRecordUri();
  if (!recordPath) throw new Error('Device documents directory not available');

  const timestamp = new Date().toISOString();
  const carriers: Record<string, CarrierOutcome> = {};

  try {
    const plainPath = recordPath.startsWith('file://') ? recordPath.slice(7) : recordPath;

    await inBackupSlot(() =>
      libraryMoved() ? Promise.resolve() : engine.runRecordBackup(plainPath)
    );
    if (libraryMoved()) return NOTHING_WRITTEN;
    // This library wrote the zip, so a later launch never offers it back.
    markPlatformRecordAnswered();
    stampDestination('device', Date.now());

    const fileInfo = await FileSystem.getInfoAsync(recordPath);
    if (!fileInfo.exists) {
      throw new Error('Record archive was not created');
    }

    const entry: Omit<BackupEntry, 'id'> = {
      timestamp,
      sizeBytes: 'size' in fileInfo ? fileInfo.size || 0 : 0,
      appVersion: APP_VERSION,
    };

    // Read once, and only when a carrier has taken the zip to compare against.
    let sentFingerprint: Promise<ZipFingerprint> | null = null;
    const sentZip = (): Promise<ZipFingerprint> => (sentFingerprint ??= zipFingerprint(recordPath));

    // A carrier that cannot be tried now is owed the zip, and leaves the stamp
    // unwritten. A permanent failure is shown to the athlete instead, and the
    // stamp is not written when nothing at all took the zip.
    const owed: string[] = [];
    let anyFailed = false;
    let anyWritten = false;
    for (const carrier of backupCarriers) {
      if (targets !== 'all' && !targets.has(carrier.id)) continue;
      if (libraryMoved()) return { wroteZip: false, carriers: {} };
      if (!(await carrier.isAvailable())) {
        log.log(`${carrier.id} not set up, skipping`);
        carriers[carrier.id] = { status: 'skipped', reason: 'unavailable' };
        continue;
      }
      if (libraryMoved()) return NOTHING_WRITTEN;
      if (carrier.isRemote && !(await isRadioUp())) {
        log.log(`Radio is down, keeping platform archive for a later ${carrier.id} upload`);
        carriers[carrier.id] = { status: 'skipped', reason: 'no-radio' };
        owed.push(carrier.id);
        continue;
      }
      try {
        const backupId = await carrier.upload(recordPath, entry);
        if (libraryMoved()) return NOTHING_WRITTEN;
        await verifyCarrierCopy(carrier, backupId, sentZip);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn(`Auto-backup to ${carrier.id} failed:`, msg);
        if (libraryMoved()) return NOTHING_WRITTEN;
        recordBackupFailure(carrier.id, error);
        const kind = isBackupTransferError(error) ? error.kind : 'unknown';
        carriers[carrier.id] = { status: 'failed', kind };
        anyFailed = true;
        if (!isBackupTransferError(error) || !error.permanent) owed.push(carrier.id);
        continue;
      }
      if (libraryMoved()) return NOTHING_WRITTEN;
      clearBackupFailure(carrier.id);
      stampDestination(carrier.id, Date.now());
      carriers[carrier.id] = { status: 'written' };
      anyWritten = true;
    }

    writeOwedCarriers(owed);
    if (owed.length === 0 && (anyWritten || !anyFailed))
      engine.setSetting(SETTING_LAST_BACKUP, String(Date.now()));
    if (libraryMoved()) return NOTHING_WRITTEN;
    log.log(`Record backup complete: ${entry.sizeBytes} bytes`);
    return { wroteZip: true, carriers };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('Auto-backup failed:', msg);
    if (libraryMoved()) return NOTHING_WRITTEN;
    // Rethrow the original so the caller keeps the failure kind
    throw error instanceof Error ? error : new Error(msg);
  }
}

/**
 * Fetch the copy a carrier now holds and compare it with the zip that was sent,
 * so a truncated or dropped write is never stamped as a backup. A copy that
 * differs, or that cannot be fetched or read, throws `unverified`, which passes
 * on its own and leaves the carrier owed. The fetched copy is deleted either way.
 */
async function verifyCarrierCopy(
  carrier: BackupBackend,
  backupId: string,
  sentZip: () => Promise<ZipFingerprint>
): Promise<void> {
  const operation = 'Read back backup';
  let copyUri: string | null = null;
  try {
    copyUri = await readBackCopyUri(`${carrier.id}-${backupId}`);
    await carrier.download(backupId, copyUri);
    const [held, sent] = await Promise.all([zipFingerprint(copyUri), sentZip()]);
    if (held.sha256 !== sent.sha256 || held.size !== sent.size) {
      throw new BackupTransferError(
        operation,
        'unverified',
        `${operation} failed: the copy does not match the zip sent (${held.size} of ${sent.size} bytes)`
      );
    }
  } catch (error) {
    if (isBackupTransferError(error) && error.kind === 'unverified') throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new BackupTransferError(operation, 'unverified', `${operation} failed: ${detail}`);
  } finally {
    if (copyUri) await FileSystem.deleteAsync(copyUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Whether the device has a radio at all. A read that throws counts as up, so
 * a permission problem or an unimplemented platform never costs a backup.
 */
async function isRadioUp(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
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
 * Backs up if the last backup is > 7 days old, or sends a copy still owed.
 */
export function onAppForeground(): void {
  if (getOwedCarriers().length === 0) {
    if (!isAutoBackupEnabled()) return;

    const lastBackup = getLastBackupTimestamp();
    if (lastBackup && Date.now() - lastBackup < STALE_INTERVAL_MS) return;
  }

  performBackup().catch(() => {});
}

/**
 * Trigger: call when the device comes back online.
 * Runs only while a copy is still owed.
 */
export function onBackupReconnect(): void {
  if (getOwedCarriers().length === 0) return;
  performBackup().catch(() => {});
}

// WebDAV config re-exported from webdavConfig.ts (avoids circular dep with webdavBackend)
export {
  getWebdavConfig,
  initWebdavConfig,
  setWebdavConfig,
  clearWebdavConfig,
  webdavUrlProblem,
} from './webdavConfig';
export type { WebdavConfig, WebdavUrlProblem } from './webdavConfig';
