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
    console.error('[Engine] excludeActivityFromSection failed:', sectionId, activityId, e);
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
    console.error('[Engine] includeActivityInSection failed:', sectionId, activityId, e);
    return false;
  }
}

export function excludeSectionLap(
  host: DelegateHost,
  sectionId: string,
  activityId: string,
  startIndex: number
): boolean {
  if (!host.ready) return false;
  try {
    host.timed('excludeSectionLap', () =>
      host.engine.sections().excludeLap(sectionId, activityId, startIndex)
    );
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] excludeSectionLap failed:', sectionId, activityId, startIndex, e);
    return false;
  }
}

export function includeSectionLap(
  host: DelegateHost,
  sectionId: string,
  activityId: string,
  startIndex: number
): boolean {
  if (!host.ready) return false;
  try {
    host.timed('includeSectionLap', () =>
      host.engine.sections().includeLap(sectionId, activityId, startIndex)
    );
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] includeSectionLap failed:', sectionId, activityId, startIndex, e);
    return false;
  }
}

export function getExcludedSectionLaps(
  host: DelegateHost,
  sectionId: string
): { activityId: string; startIndex: number }[] {
  if (!host.ready) return [];
  try {
    return host.engine.sections().getExcludedLaps(sectionId);
  } catch (e) {
    console.error('[Engine] getExcludedSectionLaps failed:', sectionId, e);
    return [];
  }
}

export function disableSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().disable(sectionId);
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] disableSection failed:', sectionId, e);
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
    console.error('[Engine] enableSection failed:', sectionId, e);
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
    console.error('[Engine] setSuperseded failed:', autoSectionId, e);
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
    console.error('[Engine] clearSuperseded failed:', customSectionId, e);
    return false;
  }
}
