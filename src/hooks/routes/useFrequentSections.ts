/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are auto-detected road sections that are frequently traveled,
 * even when the full routes differ.
 */

import { useMemo } from 'react';
import { useEngineSections } from './useRouteEngine';
import type { FrequentSection } from '@/types';
import type { RoutePoint } from '@/types';

/**
 * Type guard to validate Rust engine section data at runtime.
 * Prevents crashes when native module returns malformed data.
 *
 * @param obj - Unknown object from Rust engine
 * @returns True if object matches FrequentSection structure
 */
function isFrequentSection(obj: unknown): obj is FrequentSection {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const section = obj as Record<string, unknown>;

  // Required fields with type checks
  return (
    typeof section.id === 'string' &&
    typeof section.sportType === 'string' &&
    Array.isArray(section.polyline) &&
    typeof section.visitCount === 'number' &&
    typeof section.distanceMeters === 'number' &&
    Array.isArray(section.activityIds) &&
    Array.isArray(section.routeIds)
    // Optional fields are not validated (they can be undefined)
  );
}

export interface UseFrequentSectionsOptions {
  /** Filter by sport type (e.g., "Run", "Ride") */
  sportType?: string;
  /** Minimum visit count to include */
  minVisits?: number;
  /** Sort order */
  sortBy?: 'visits' | 'distance' | 'name';
}

export interface UseFrequentSectionsResult {
  /** Filtered and sorted sections */
  sections: FrequentSection[];
  /** Total number of sections (before filtering) */
  totalCount: number;
  /** Whether sections are ready (cache loaded) */
  isReady: boolean;
}

export function useFrequentSections(
  options: UseFrequentSectionsOptions = {}
): UseFrequentSectionsResult {
  const { sportType, minVisits = 3, sortBy = 'visits' } = options;

  const { sections: rawSections, totalCount } = useEngineSections({
    sportType,
    minVisits: 1,
  });
  const isReady = true;

  const sections = useMemo(() => {
    // Filter and validate in one pass - removes malformed data
    let filtered = rawSections.filter(isFrequentSection);

    // Filter by sport type (already done by useEngineSections, but double-check)
    if (sportType) {
      filtered = filtered.filter((s) => s.sportType === sportType);
    }

    // Filter by minimum visits
    filtered = filtered.filter((s) => s.visitCount >= minVisits);

    // Sort
    switch (sortBy) {
      case 'visits':
        filtered.sort((a, b) => b.visitCount - a.visitCount);
        break;
      case 'distance':
        filtered.sort((a, b) => b.distanceMeters - a.distanceMeters);
        break;
      case 'name':
        filtered.sort((a, b) => a.id.localeCompare(b.id));
        break;
    }

    return filtered;
  }, [rawSections, sportType, minVisits, sortBy]);

  return {
    sections,
    totalCount,
    isReady,
  };
}
