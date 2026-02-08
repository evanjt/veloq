/**
 * Shared conversion functions for native section types to app section types.
 */

import {
  gpsPointsToRoutePoints,
  type FrequentSection as NativeFrequentSection,
  type Section as NativeSection,
} from 'veloqrs';
import { convertActivityPortions } from '@/lib/utils/ffiConversions';
import type { FrequentSection } from '@/types';

/**
 * Convert a native section (FfiFrequentSection or FfiSection) to app section format.
 *
 * FfiFrequentSection: returned by getSections/getEngineSections (non-optional fields)
 * FfiSection: returned by getSectionsForActivity (many optional fields)
 */
export function convertNativeSectionToApp(
  native: NativeFrequentSection | NativeSection
): FrequentSection {
  const polyline = gpsPointsToRoutePoints(native.polyline);

  // Determine section type - FfiSection has sectionType string, FfiFrequentSection doesn't
  const sectionType =
    'sectionType' in native
      ? ((native.sectionType === 'custom' ? 'custom' : 'auto') as 'auto' | 'custom')
      : 'auto';

  // Convert activityPortions if present (FfiFrequentSection has them, FfiSection doesn't)
  const activityPortions =
    'activityPortions' in native && Array.isArray(native.activityPortions)
      ? convertActivityPortions(native.activityPortions)
      : undefined;

  return {
    id: native.id,
    sectionType,
    sportType: native.sportType,
    polyline,
    representativeActivityId: native.representativeActivityId ?? '',
    activityIds: native.activityIds,
    activityPortions,
    routeIds: ('routeIds' in native ? native.routeIds : undefined) ?? [],
    visitCount: native.visitCount,
    distanceMeters: native.distanceMeters,
    name: native.name ?? undefined,
    confidence: native.confidence ?? 0,
    observationCount: native.observationCount ?? 0,
    averageSpread: native.averageSpread ?? 0,
    pointDensity: native.pointDensity ?? [],
    stability: ('stability' in native ? native.stability : undefined) ?? undefined,
    version: ('version' in native ? native.version : undefined) ?? undefined,
    updatedAt: ('updatedAt' in native ? native.updatedAt : undefined) ?? undefined,
    createdAt: ('createdAt' in native ? native.createdAt : undefined) || new Date().toISOString(),
  };
}
