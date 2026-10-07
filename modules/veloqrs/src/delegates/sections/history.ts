/**
 * Section ledger delegates.
 *
 * The engine records every change a section goes through (formed, re-cut,
 * split, merged, dissolved, restored, reverted) with the geometry it had
 * and what was around the change. These read that ledger, draw a stored
 * version, and put one back.
 */

import { decodeCoords } from '../../coords';
import type { LatLngShort } from '../../coords';
import type {
  FfiDepartedRide,
  FfiRetiredSection,
  FfiSectionChange,
  FfiSectionGeometryVersion,
  FfiSectionHistoryEvent,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

export type SectionHistoryEvent = FfiSectionHistoryEvent;
export type SectionGeometryVersion = FfiSectionGeometryVersion;
export type RetiredSection = FfiRetiredSection;
export type SectionChange = FfiSectionChange;

export function getSectionHistory(host: DelegateHost, sectionId: string): SectionHistoryEvent[] {
  if (!host.ready) return [];
  return host.timed('getHistory', () => host.engine.sections().getHistory(sectionId));
}

export function getSectionGeometryVersions(
  host: DelegateHost,
  sectionId: string
): SectionGeometryVersion[] {
  if (!host.ready) return [];
  return host.timed('getGeometryVersions', () =>
    host.engine.sections().getGeometryVersions(sectionId)
  );
}

/** A stored version's line, or an empty list when it was pruned. */
export function getSectionGeometryVersionPolyline(
  host: DelegateHost,
  sectionId: string,
  version: number
): LatLngShort[] {
  if (!host.ready) return [];
  const coords = host.timed('getGeometryVersionCoords', () =>
    host.engine.sections().getGeometryVersionCoords(sectionId, version)
  );
  return decodeCoords(coords).map((p) => ({ lat: p.latitude, lng: p.longitude }));
}

export function revertSectionToVersion(
  host: DelegateHost,
  sectionId: string,
  version: number
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  try {
    const departed = host.timed('revertToVersion', () =>
      host.engine.sections().revertToVersion(sectionId, version)
    );
    host.notifyAll('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] revertSectionToVersion failed:', sectionId, version, e);
    return null;
  }
}

export function unpinSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.timed('unpin', () => host.engine.sections().unpin(sectionId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] unpinSection failed:', sectionId, e);
    return false;
  }
}

export function getPinnedSectionVersion(host: DelegateHost, sectionId: string): number | null {
  if (!host.ready) return null;
  const v = host.timed('getPinnedVersion', () =>
    host.engine.sections().getPinnedVersion(sectionId)
  );
  return v ?? null;
}

export function getRetiredSections(host: DelegateHost): RetiredSection[] {
  if (!host.ready) return [];
  return host.timed('getRetired', () => host.engine.sections().getRetired());
}
