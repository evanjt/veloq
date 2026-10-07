/**
 * Settings delegates.
 *
 * Wraps SQLite-backed user preferences, athlete profile, sport settings, and
 * name translations. All writes are best-effort - failures log but don't throw.
 * Writes go through `host.write`, so one made before the engine opened is
 * replayed rather than dropped.
 */

import type { DelegateHost } from './host';
import type {
  FfiNotificationTemplates,
  SettingPair,
  SuggestedHome as FfiSuggestedHome,
  ExportPrivacyPreview as FfiExportPrivacyPreview,
  FfiGpsPoint,
  GpxFile as FfiGpxFile,
  FfiBackupScreenData,
  FfiCacheScreenData,
  FfiBackgroundJobsData,
} from '../generated/veloqrs';

export function setNameTranslations(
  host: DelegateHost,
  routeWord: string,
  sectionWord: string
): void {
  host.write('setNameTranslations', () => host.engine.setNameTranslations(routeWord, sectionWord));
}

export function setAthleteProfile(host: DelegateHost, json: string): void {
  host.write('setAthleteProfile', () => {
    try {
      host.engine.settings().setAthleteProfile(json);
    } catch (e) {
      console.error('[Engine] setAthleteProfile failed:', e);
    }
  });
}

export function getAthleteProfile(host: DelegateHost): string {
  if (!host.ready) return '';
  return host.timed('getAthleteProfile', () => host.engine.settings().getAthleteProfile()) ?? '';
}

export function setSportSettings(host: DelegateHost, json: string): void {
  host.write('setSportSettings', () => {
    try {
      host.engine.settings().setSportSettings(json);
    } catch (e) {
      console.error('[Engine] setSportSettings failed:', e);
    }
  });
}

export function getSportSettings(host: DelegateHost): string {
  if (!host.ready) return '';
  return host.timed('getSportSettings', () => host.engine.settings().getSportSettings()) ?? '';
}

/**
 * The heart rate zone, numbered from 1, a reading falls in for a sport type,
 * from the athlete's own zones. Null when the engine is not open or the reading
 * is not a positive number. A failed read throws the engine's error.
 */
export function hrZoneFor(host: DelegateHost, sportType: string, bpm: number): number | null {
  if (!host.ready) return null;
  return host.timed('hrZoneFor', () => host.engine.settings().hrZoneFor(sportType, bpm)) ?? null;
}

/**
 * Where the athlete's rides start and finish most often, for the export
 * privacy row to offer. A guess, so the trim stays off until it is confirmed
 * or replaced, and a library with too little to cluster answers null.
 */
export function suggestExportHome(host: DelegateHost): FfiSuggestedHome | null {
  if (!host.ready) return null;
  return host.timed('suggestExportHome', () => host.engine.settings().suggestExportHome()) ?? null;
}

export function getBackupScreenData(host: DelegateHost): FfiBackupScreenData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getBackupScreenData', () => host.engine.settings().backupScreenData());
}

export function getCacheScreenData(host: DelegateHost): FfiCacheScreenData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getCacheScreenData', () => host.engine.settings().cacheScreenData());
}

/**
 * Each background job's last run and what the jobs still owe. Read when a job
 * settles or activities land, never on the progress poll.
 */
export function getBackgroundJobsData(host: DelegateHost): FfiBackgroundJobsData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getBackgroundJobsData', () => host.engine.settings().backgroundJobsData());
}

/**
 * What a trim at this home and radius would reach, so the row can name rides
 * rather than metres. A read, so it returns null rather than queueing.
 */
export function exportPrivacyPreview(
  host: DelegateHost,
  homeLat: number,
  homeLng: number,
  radiusM: number
): FfiExportPrivacyPreview | null {
  if (!host.ready) return null;
  return host.timed('exportPrivacyPreview', () =>
    host.engine.settings().exportPrivacyPreview(homeLat, homeLng, radiusM)
  );
}

/**
 * The GPX file for one shared track with the export privacy trim applied, or
 * null when the trim leaves too little to be a track. Throws when the engine
 * cannot answer, because a file shared without the trim would carry the door.
 */
export function buildGpxFile(
  host: DelegateHost,
  name: string,
  sport: string | undefined,
  time: string | undefined,
  points: FfiGpsPoint[]
): FfiGpxFile | null {
  if (!host.ready) throw new Error('Engine not ready');
  return (
    host.timed('buildGpxFile', () =>
      host.engine.settings().buildGpxFile(name, sport, time, points)
    ) ?? null
  );
}

export function engineInstall(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('engineInstall', () => host.engine.settings().engineInstall());
}

export function getSetting(host: DelegateHost, key: string): string | undefined {
  if (!host.ready) return undefined;
  return host.timed('getSetting', () => host.engine.settings().getSetting(key)) ?? undefined;
}

export function setSetting(host: DelegateHost, key: string, value: string): void {
  host.write('setSetting', () => {
    try {
      host.engine.settings().setSetting(key, value);
    } catch {
      // Settings write failed - non-critical
    }
  });
}

/**
 * Write several settings in one transaction, skipping each pair whose value
 * is already stored. A batch written before the engine opens is held and
 * replayed at `initWithPath`, like every other write here. One commit is two
 * fsyncs on the calling thread, so a launch that changes several keys pays it
 * once.
 */
export function setSettings(host: DelegateHost, pairs: SettingPair[]): void {
  if (pairs.length === 0) return;
  host.write('setSettings', () => {
    try {
      host.engine.settings().setSettings(pairs);
    } catch {
      // Settings write failed - non-critical
    }
  });
}

/**
 * Hand the engine the notification templates for the locale the app is
 * running in, so a push handler woken with no JavaScript alive can still write
 * a sentence. Answers whether anything was written, which is false for the
 * ordinary launch that re-pushes the bundle it pushed last time.
 *
 * Durable, unlike `setNameTranslations` beside it, which keeps its two words
 * in a process global a fresh process cannot read.
 */
export function setNotificationTemplates(
  host: DelegateHost,
  locale: string,
  templates: SettingPair[]
): boolean {
  if (!host.ready || templates.length === 0) return false;
  try {
    return host.timed('setNotificationTemplates', () =>
      host.engine.settings().setNotificationTemplates(locale, templates)
    );
  } catch {
    // A stored bundle that stays one locale behind beats a throw on launch.
    return false;
  }
}

/** The templates the last push left, or undefined before any push. */
export function notificationTemplates(host: DelegateHost): FfiNotificationTemplates | undefined {
  if (!host.ready) return undefined;
  return (
    host.timed('notificationTemplates', () => host.engine.settings().notificationTemplates()) ??
    undefined
  );
}

/**
 * Days of stream history the athlete keeps, 0 meaning keep everything. This
 * only ever evicts stored series: nothing deletes whole activities by age.
 */
export function streamRetentionDays(host: DelegateHost): number | undefined {
  if (!host.ready) return undefined;
  return host.timed('streamRetentionDays', () => host.engine.settings().streamRetentionDays());
}

/** Set the window and evict what now falls outside it. */
export function setStreamRetentionDays(host: DelegateHost, days: number): void {
  host.write('setStreamRetentionDays', () => {
    try {
      host.engine.settings().setStreamRetentionDays(days);
    } catch {
      // A failed write leaves the previous window in force, which is the safe
      // side: nothing is evicted that the athlete did not ask to evict.
    }
  });
}

/** Bytes the stream store holds, for the cache readout. */
export function streamStoreBytes(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('streamStoreBytes', () => host.engine.settings().streamStoreBytes());
}

export function deleteSetting(host: DelegateHost, key: string): void {
  host.write('deleteSetting', () => {
    try {
      host.engine.settings().deleteSetting(key);
    } catch {
      // Settings delete failed - non-critical
    }
  });
}
