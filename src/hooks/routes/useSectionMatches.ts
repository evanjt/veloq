/**
 * Hook for getting sections that an activity belongs to.
 * Used to display matched sections in the activity detail view.
 *
 * OPTIMIZED: Uses getSectionsForActivity() FFI function with junction table
 * for O(1) lookup instead of loading all sections (~250-570ms → ~10-20ms).
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useDisabledSections } from '@/providers';
import { generateSectionName } from '@/lib/utils/sectionNaming';
import { gpsPointsToRoutePoints, type FrequentSection as NativeFrequentSection } from 'veloqrs';
import type { FrequentSection, SectionPortion } from '@/types';

/**
 * Convert native section (GpsPoint) to app section (RoutePoint).
 */
function convertNativeSectionToApp(native: NativeFrequentSection): FrequentSection {
  // Convert polyline from GpsPoint[] to RoutePoint[]
  const polyline = gpsPointsToRoutePoints(native.polyline);

  // Use actual section type from database (auto or custom)
  // Fall back to 'auto' if not present for backwards compatibility
  const sectionType =
    (native as unknown as { sectionType?: 'auto' | 'custom' }).sectionType || 'auto';

  // Cast activityPortions direction from string to union type
  const activityPortions = native.activityPortions?.map((p) => ({
    ...p,
    direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
  }));

  return {
    id: native.id,
    sectionType,
    sportType: native.sportType,
    polyline,
    representativeActivityId: native.representativeActivityId,
    activityIds: native.activityIds,
    activityPortions,
    routeIds: native.routeIds,
    visitCount: native.visitCount,
    distanceMeters: native.distanceMeters,
    name: native.name,
    confidence: native.confidence,
    observationCount: native.observationCount,
    averageSpread: native.averageSpread,
    pointDensity: native.pointDensity,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Runtime type guard for FrequentSection from engine.
 * Validates essential properties to prevent crashes from malformed engine data.
 */
function isValidSection(value: unknown): value is FrequentSection {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.visitCount === 'number' &&
    Array.isArray(obj.activityIds) &&
    typeof obj.distanceMeters === 'number'
  );
}

export interface SectionMatch {
  /** The section */
  section: FrequentSection;
  /** This activity's portion data */
  portion?: SectionPortion;
  /** Direction: 'same' or 'reverse' */
  direction: 'same' | 'reverse';
  /** Section distance in meters */
  distance: number;
}

export interface UseSectionMatchesResult {
  /** Sections this activity belongs to */
  sections: SectionMatch[];
  /** Total number of sections */
  count: number;
  /** Whether data is ready */
  isReady: boolean;
}

/**
 * Get all sections that contain a given activity.
 *
 * OPTIMIZED: Uses junction table lookup instead of loading all sections.
 * Previous: ~250-570ms (load ALL sections, filter in JS)
 * Now: ~10-20ms (query only sections for this activity)
 */
export function useSectionMatches(activityId: string | undefined): UseSectionMatchesResult {
  // Lightweight refresh trigger for section changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTrigger((r) => r + 1);
  }, []);

  // Subscribe to section changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('sections', refresh);
    return unsubscribe;
  }, [refresh]);

  // Check if engine has any sections (lightweight O(1) check)
  const sectionCount = useMemo(() => {
    const engine = getRouteEngine();
    return engine?.getSectionCount() ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const isReady = sectionCount > 0;

  // Get disabled sections to filter them out
  const disabledIds = useDisabledSections((s) => s.disabledIds);

  const sections = useMemo(() => {
    if (!activityId) {
      return [];
    }

    const engine = getRouteEngine();
    if (!engine) {
      return [];
    }

    // OPTIMIZED: Query only sections for this activity via junction table
    const nativeSections = engine.getSectionsForActivity(activityId);

    const matches: SectionMatch[] = [];

    for (const native of nativeSections) {
      // Convert to app format
      const converted = convertNativeSectionToApp(native);
      const section = {
        ...converted,
        name: generateSectionName(converted),
      };

      // Validate section structure to prevent crashes from malformed engine data
      if (!isValidSection(section)) {
        continue;
      }

      // Skip disabled sections
      if (disabledIds.has(section.id)) {
        continue;
      }

      // Find the portion data for this activity
      const portion = section.activityPortions?.find((p) => p.activityId === activityId);

      matches.push({
        section,
        portion: portion as SectionPortion | undefined,
        direction: (portion?.direction as 'same' | 'reverse') || 'same',
        distance: portion?.distanceMeters || section.distanceMeters,
      });
    }

    // Sort by visit count (most popular first)
    matches.sort((a, b) => b.section.visitCount - a.section.visitCount);

    return matches;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, disabledIds, refreshTrigger]);

  return {
    sections,
    count: sections.length,
    isReady,
  };
}
