/**
 * Settings delegates.
 *
 * Wraps SQLite-backed user preferences, athlete profile, sport settings, and
 * name translations. All writes are best-effort — failures log but don't throw.
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
    // Settings write failed — non-critical
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
    // Settings write failed — non-critical
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
    // Settings write failed — non-critical
  }
}

export function getAllSettings(host: DelegateHost): Record<string, string> {
  if (!host.ready) return {};
  try {
    const json = host.engine.settings().getAllSettings();
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

export function setAllSettings(host: DelegateHost, settings: Record<string, string>): void {
  if (!host.ready) return;
  try {
    host.engine.settings().setAllSettings(JSON.stringify(settings));
  } catch {
    // Settings write failed — non-critical
  }
}

export function deleteSetting(host: DelegateHost, key: string): void {
  if (!host.ready) return;
  try {
    host.engine.settings().deleteSetting(key);
  } catch {
    // Settings delete failed — non-critical
  }
}
