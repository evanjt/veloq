/**
 * Section visibility delegates.
 *
 * Toggles that affect which sections and activities participate in queries
 * without deleting underlying data: per-activity exclude/include, section
 * disable/enable, superseded mappings (auto → custom replacements), and bulk
 * imports used during backup restore.
 */

import type { DelegateHost } from '../host';

export function excludeActivityFromSection(
  host: DelegateHost,
  sectionId: string,
  activityId: string
): boolean {
  if (!host.ready) return false;
  try {
    host.timed('excludeActivityFromSection', () =>
      host.engine.sections().excludeActivity(sectionId, activityId)
    );
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] excludeActivityFromSection failed:', sectionId, activityId, e);
    return false;
  }
}

export function includeActivityInSection(
  host: DelegateHost,
  sectionId: string,
  activityId: string
): boolean {
  if (!host.ready) return false;
  try {
    host.timed('includeActivityInSection', () =>
      host.engine.sections().includeActivity(sectionId, activityId)
    );
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] includeActivityInSection failed:', sectionId, activityId, e);
    return false;
  }
}

export function disableSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().disable(sectionId);
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] disableSection failed:', sectionId, e);
    return false;
  }
}

export function enableSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().enable(sectionId);
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] enableSection failed:', sectionId, e);
    return false;
  }
}

export function setSuperseded(
  host: DelegateHost,
  autoSectionId: string,
  customSectionId: string
): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().setSuperseded(autoSectionId, customSectionId);
    return true;
  } catch (e) {
    console.error('[RouteEngine] setSuperseded failed:', autoSectionId, e);
    return false;
  }
}

export function clearSuperseded(host: DelegateHost, customSectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().clearSuperseded(customSectionId);
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] clearSuperseded failed:', customSectionId, e);
    return false;
  }
}

export function importDisabledIds(host: DelegateHost, ids: string[]): number {
  if (!host.ready || ids.length === 0) return 0;
  try {
    return host.engine.sections().importDisabledIds(ids);
  } catch (e) {
    console.error('[RouteEngine] importDisabledIds failed:', e);
    return 0;
  }
}

export function importSupersededMap(host: DelegateHost, map: Record<string, string[]>): number {
  if (!host.ready) return 0;
  const entries = Object.entries(map).map(([customSectionId, autoSectionIds]) => ({
    customSectionId,
    autoSectionIds,
  }));
  if (entries.length === 0) return 0;
  try {
    return host.engine.sections().importSupersededMap(entries);
  } catch (e) {
    console.error('[RouteEngine] importSupersededMap failed:', e);
    return 0;
  }
}
