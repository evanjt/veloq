/**
 * Shared conversion functions for native section types to app section types.
 */

import { decodeCoords, type Section as NativeSection } from 'veloqrs';
import { convertActivityPortions } from '@/shared/ffi/ffiConversions';
import type { FrequentSection } from '@/types';

/**
 * Convert a native section to app section format.
 *
 * Every section-returning export sends the same record, whether it came from
 * the in-memory catalogue (`getSections`, `getSectionsFiltered`,
 * `getSectionById`) or the database (`getSectionsForActivity`, `getByType`).
 */
export function convertNativeSectionToApp(native: NativeSection): FrequentSection {
  const polyline = decodeCoords(native.encodedPolyline).map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));

  return {
    id: native.id,
    sectionType: native.sectionType === 'custom' ? 'custom' : 'auto',
    sportType: native.sportType,
    polyline,
    representativeActivityId: native.representativeActivityId ?? '',
    activityIds: native.activityIds,
    activityPortions: convertActivityPortions(native.activityPortions),
    routeIds: native.routeIds ?? [],
    visitCount: native.visitCount,
    distanceMeters: native.distanceMeters,
    name: native.name ?? undefined,
    confidence: native.confidence ?? 0,
    observationCount: native.observationCount ?? 0,
    averageSpread: native.averageSpread ?? 0,
    pointDensity: native.pointDensity ?? [],
    stability: native.stability ?? undefined,
    elevationGainM: native.elevationGainM ?? undefined,
    elevationLossM: native.elevationLossM ?? undefined,
    avgGradePercent: native.avgGradePercent ?? undefined,
    maxGradePercent: native.maxGradePercent ?? undefined,
    klass: native.klass ?? undefined,
    isLift: native.isLift,
    rankScore: native.rankScore ?? undefined,
    sportRankScore: native.sportRankScore ?? undefined,
    version: native.version ?? undefined,
    updatedAt: native.updatedAt ?? undefined,
    createdAt: native.createdAt ?? '',
    isUserDefined: native.isUserDefined,
    disabled: native.disabled,
    supersededBy: native.supersededBy ?? null,
  };
}
