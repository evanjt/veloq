/**
 * Section ledger delegates.
 *
 * The engine records every change a section goes through (formed, re-cut,
 * split, merged, dissolved, restored, reverted) with the geometry it had
 * and what was around the change. These read that ledger, draw a stored
 * version, and unpin the section. Putting a version back is a section edit,
 * run off the JS thread through `runSectionBoundsEdit`.
 */

import { decodeCoords } from '../../coords';
import type { LatLngShort } from '../../coords';
import type {
  FfiRetiredMapData,
  FfiRetiredSection,
  FfiSectionChange,
  FfiSectionHistoryEvent,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

export type SectionHistoryEvent = FfiSectionHistoryEvent;
export type RetiredSection = FfiRetiredSection;
export type RetiredMapData = FfiRetiredMapData;
export type SectionChange = FfiSectionChange;

export function getSectionHistory(host: DelegateHost, sectionId: string): SectionHistoryEvent[] {
  if (!host.ready) return [];
  return host.timed('getHistory', () => host.engine.sections().getHistory(sectionId));
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

/**
 * Everything the old-versus-new sections map draws, in one read: the retired
 * sections with their lines, every catalogue row hidden ones included, and
 * the pairs between them. Undefined while the engine is not ready.
 */
export function getRetiredMapData(host: DelegateHost): RetiredMapData | undefined {
  if (!host.ready) return undefined;
  return host.timed('getRetiredMap', () => host.engine.sections().getRetiredMap());
}
