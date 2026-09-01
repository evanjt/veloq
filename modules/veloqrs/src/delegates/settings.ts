/**
 * Settings delegates.
 *
 * Wraps SQLite-backed user preferences, athlete profile, sport settings, and
 * name translations. All writes are best-effort - failures log but don't throw.
 */

import type { DelegateHost } from './host';

export function setNameTranslations(
  host: DelegateHost,
  routeWord: string,
  sectionWord: string
): void {
  if (!host.ready) return;
  host.timed('setNameTranslations', () => host.engine.setNameTranslations(routeWord, sectionWord));
}

export function setAthleteProfile(host: DelegateHost, json: string): void {
  if (!host.ready) return;
  try {
    host.timed('setAthleteProfile', () => host.engine.settings().setAthleteProfile(json));
  } catch {
    // Settings write failed - non-critical
  }
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
  if (!host.ready) return;
  try {
    host.timed('setSportSettings', () => host.engine.settings().setSportSettings(json));
  } catch {
    // Settings write failed - non-critical
  }
}

export function getSportSettings(host: DelegateHost): string {
  if (!host.ready) return '';
  try {
    return host.timed('getSportSettings', () => host.engine.settings().getSportSettings()) ?? '';
  } catch {
    return '';
  }
}

export function clearUserProfileCaches(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    // Cast to bypass stale generated bindings - the regenerated SettingsManager
    // (after `npm run clean:rust && npx expo run:android`) has this method, but
    // tsc would fail against the pre-rebuild .d.ts. Method binding via UniFFI
    // resolves at runtime, and the catch below absorbs the case where Rust
    // hasn't been rebuilt yet.
    const settings = host.engine.settings() as unknown as {
      clearUserProfileCaches?: () => void;
    };
    host.timed('clearUserProfileCaches', () => {
      settings.clearUserProfileCaches?.();
    });
  } catch {
    // Best-effort - failures here just leave stale rows that engine.clear() would catch later.
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
  if (!host.ready) return;
  try {
    host.engine.settings().setSetting(key, value);
  } catch {
    // Settings write failed - non-critical
  }
}

/**
 * Days of stream history the athlete keeps, 0 meaning keep everything. Not the
 * activity `retentionDays` in `RouteSettingsStore`, which deletes whole
 * activities; this one only ever evicts stored series.
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
  if (!host.ready) return;
  try {
    host.engine.settings().setStreamRetentionDays(BigInt(Math.trunc(days)));
  } catch {
    // A failed write leaves the previous window in force, which is the safe
    // side: nothing is evicted that the athlete did not ask to evict.
  }
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
  if (!host.ready) return;
  try {
    host.engine.settings().deleteSetting(key);
  } catch {
    // Settings delete failed - non-critical
  }
}
