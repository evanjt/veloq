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
    } catch {
      // Settings write failed - non-critical
    }
  });
}

export function getAthleteProfile(host: DelegateHost): string {
  if (!host.ready) return '';
  try {
    return host.timed('getAthleteProfile', () => host.engine.settings().getAthleteProfile()) ?? '';
  } catch {
    return '';
  }
}

export function setSportSettings(host: DelegateHost, json: string): void {
  host.write('setSportSettings', () => {
    try {
      host.engine.settings().setSportSettings(json);
    } catch {
      // Settings write failed - non-critical
    }
  });
}

export function getSportSettings(host: DelegateHost): string {
  if (!host.ready) return '';
  try {
    return host.timed('getSportSettings', () => host.engine.settings().getSportSettings()) ?? '';
  } catch {
    return '';
  }
}


/**
 * Where the athlete's rides start and finish most often, for the export
 * privacy row to offer. A guess, so the trim stays off until it is confirmed
 * or replaced, and a library with too little to cluster answers null.
 */
export function suggestExportHome(host: DelegateHost): FfiSuggestedHome | null {
  if (!host.ready) return null;
  try {
    return host.timed('suggestExportHome', () => host.engine.settings().suggestExportHome()) ?? null;
  } catch (e) {
    console.error('[Engine] suggestExportHome threw:', e);
    return null;
  }
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
  try {
    return host.timed('exportPrivacyPreview', () =>
      host.engine.settings().exportPrivacyPreview(homeLat, homeLng, radiusM)
    );
  } catch (e) {
    console.error('[Engine] exportPrivacyPreview threw:', e);
    return null;
  }
}

export function getSetting(host: DelegateHost, key: string): string | undefined {
  if (!host.ready) return undefined;
  try {
    return host.engine.settings().getSetting(key) ?? undefined;
  } catch {
    return undefined;
  }
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
 * is already stored. Returns how many were written, or 0 when the engine is
 * not up. One commit is two fsyncs on the calling thread, so a launch that
 * changes several keys pays it once.
 */
export function setSettings(host: DelegateHost, pairs: SettingPair[]): number {
  if (!host.ready || pairs.length === 0) return 0;
  try {
    return host.timed('setSettings', () => host.engine.settings().setSettings(pairs));
  } catch {
    // Settings write failed - non-critical
    return 0;
  }
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
export function notificationTemplates(
  host: DelegateHost
): FfiNotificationTemplates | undefined {
  if (!host.ready) return undefined;
  try {
    return host.engine.settings().notificationTemplates() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Days of stream history the athlete keeps, 0 meaning keep everything. This
 * only ever evicts stored series: nothing deletes whole activities by age.
 */
export function streamRetentionDays(host: DelegateHost): number | undefined {
  if (!host.ready) return undefined;
  try {
    return Number(host.engine.settings().streamRetentionDays());
  } catch {
    return undefined;
  }
}

/** Set the window and evict what now falls outside it. */
export function setStreamRetentionDays(host: DelegateHost, days: number): void {
  const window = BigInt(Math.trunc(days));
  host.write('setStreamRetentionDays', () => {
    try {
      host.engine.settings().setStreamRetentionDays(window);
    } catch {
      // A failed write leaves the previous window in force, which is the safe
      // side: nothing is evicted that the athlete did not ask to evict.
    }
  });
}

/** Bytes the stream store holds, for the cache readout. */
export function streamStoreBytes(host: DelegateHost): number {
  if (!host.ready) return 0;
  try {
    return Number(host.engine.settings().streamStoreBytes());
  } catch {
    return 0;
  }
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
