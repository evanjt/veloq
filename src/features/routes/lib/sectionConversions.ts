/**
 * The engine's section records, in the shape the app draws.
 *
 * One builder per record and no more, each spreading rather than listing its
 * fields, so an enrichment column reaches every screen the day the engine
 * starts sending it. Listing is what left `straightness` on three engine
 * records with no app field at all, and `isLift` off the sections list while
 * the detail screen had it.
 */

import {
  decodeCoords,
  type Section as NativeSection,
  type SectionSummary as NativeSectionSummary,
  type SectionWithPolyline,
} from 'veloqrs';
import { convertActivityPortions } from '@/shared/ffi/ffiConversions';
import type { FrequentSection, RoutePoint, SectionType } from '@/types';

/** The engine sends coordinates encoded; every screen draws them decoded. */
function decodePolyline(encoded: ArrayBuffer): RoutePoint[] {
  return decodeCoords(encoded).map((p) => ({ lat: p.latitude, lng: p.longitude }));
}

/** "custom" or "auto", never the raw string the engine sent. */
function sectionTypeOf(value: string | undefined): SectionType {
  return value === 'custom' ? 'custom' : 'auto';
}

/**
 * The full section record, from the in-memory catalogue or the database.
 *
 * Every section-returning export sends this one shape, whichever filter asked
 * for it.
 */
export function convertNativeSectionToApp(native: NativeSection): FrequentSection {
  return {
    ...native,
    sectionType: sectionTypeOf(native.sectionType),
    polyline: decodePolyline(native.encodedPolyline),
    representativeActivityId: native.representativeActivityId ?? '',
    activityPortions: convertActivityPortions(native.activityPortions),
    routeIds: native.routeIds ?? [],
    name: native.name ?? undefined,
    confidence: native.confidence ?? 0,
    observationCount: native.observationCount ?? 0,
    averageSpread: native.averageSpread ?? 0,
    pointDensity: native.pointDensity ?? [],
    createdAt: native.createdAt ?? '',
    supersededBy: native.supersededBy ?? null,
  };
}

/**
 * The list record, which carries its own polyline so a row needs no call of
 * its own. It has no `activityIds`: the list does not ask for them.
 */
export function convertSectionWithPolylineToApp(native: SectionWithPolyline): FrequentSection {
  return {
    ...native,
    sectionType: native.id.startsWith('custom_') ? 'custom' : 'auto',
    polyline: decodePolyline(native.encodedPolyline),
    activityIds: [],
    routeIds: [],
    name: native.name ?? undefined,
    scale: native.scale ?? undefined,
    createdAt: new Date().toISOString(),
    supersededBy: native.supersededBy ?? null,
  };
}

/**
 * The summary record, which carries no geometry at all. A caller that draws
 * the line fetches it separately.
 */
export function convertSectionSummaryToApp(native: NativeSectionSummary): FrequentSection {
  return {
    ...native,
    sectionType: sectionTypeOf(native.sectionType),
    polyline: [],
    activityIds: [],
    name: native.name ?? undefined,
    supersededBy: native.supersededBy ?? null,
  };
}
