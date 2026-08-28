/**
 * Section ledger delegates.
 *
 * The engine records every change a section goes through (formed, re-cut,
 * split, merged, dissolved, restored, reverted) with the geometry it had
 * and what was around the change. These read that ledger, draw a stored
 * version, and put one back.
 */

import { decodeCoords } from '../../coords';
import type { RoutePoint } from '../../conversions';
import type {
  FfiRetiredSection,
  FfiSectionGeometryVersion,
  FfiSectionHistoryEvent,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

export type SectionHistoryEvent = FfiSectionHistoryEvent;
export type SectionGeometryVersion = FfiSectionGeometryVersion;
export type RetiredSection = FfiRetiredSection;

export function getSectionHistory(host: DelegateHost, sectionId: string): SectionHistoryEvent[] {
  if (!host.ready) return [];
  try {
    return host.engine.sections().getHistory(sectionId);
  } catch (e) {
    console.error('[RouteEngine] getSectionHistory failed:', sectionId, e);
    return [];
  }
}

export function getSectionGeometryVersions(
  host: DelegateHost,
  sectionId: string
): SectionGeometryVersion[] {
  if (!host.ready) return [];
  try {
    return host.engine.sections().getGeometryVersions(sectionId);
  } catch (e) {
    console.error('[RouteEngine] getSectionGeometryVersions failed:', sectionId, e);
    return [];
  }
}

/** A stored version's line, or an empty list when it was pruned. */
export function getSectionGeometryVersionPolyline(
  host: DelegateHost,
  sectionId: string,
  version: number
): RoutePoint[] {
  if (!host.ready) return [];
  try {
    return decodeCoords(
      host.engine.sections().getGeometryVersionCoords(sectionId, BigInt(version))
    ).map((p) => ({ lat: p.latitude, lng: p.longitude }));
  } catch (e) {
    console.error('[RouteEngine] getSectionGeometryVersionPolyline failed:', sectionId, version, e);
    return [];
  }
}

export function revertSectionToVersion(
  host: DelegateHost,
  sectionId: string,
  version: number
): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().revertToVersion(sectionId, BigInt(version));
    return true;
  } catch (e) {
    console.error('[RouteEngine] revertSectionToVersion failed:', sectionId, version, e);
    return false;
  }
}

export function unpinSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  try {
    host.engine.sections().unpin(sectionId);
    return true;
  } catch (e) {
    console.error('[RouteEngine] unpinSection failed:', sectionId, e);
    return false;
  }
}

export function getPinnedSectionVersion(host: DelegateHost, sectionId: string): number | null {
  if (!host.ready) return null;
  try {
    const v = host.engine.sections().getPinnedVersion(sectionId);
    return v == null ? null : Number(v);
  } catch (e) {
    console.error('[RouteEngine] getPinnedSectionVersion failed:', sectionId, e);
    return null;
  }
}

export function getRetiredSections(host: DelegateHost): RetiredSection[] {
  if (!host.ready) return [];
  try {
    return host.engine.sections().getRetired();
  } catch (e) {
    console.error('[RouteEngine] getRetiredSections failed:', e);
    return [];
  }
}
