/**
 * Hook for getting sections that an activity belongs to.
 * Used to display matched sections in the activity detail view.
 */

import { useMemo } from 'react';
import { useEngineSections } from './useRouteEngine';
import type { FrequentSection, SectionPortion } from '@/types';

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
 */
export function useSectionMatches(activityId: string | undefined): UseSectionMatchesResult {
  const { sections: allSections, totalCount } = useEngineSections();
  const isReady = totalCount > 0;

  const sections = useMemo(() => {
    if (!activityId || allSections.length === 0) {
      return [];
    }

    const matches: SectionMatch[] = [];

    for (const section of allSections) {
      // Validate section structure to prevent crashes from malformed engine data
      if (!isValidSection(section)) {
        continue;
      }

      // Check if activity is in this section's activity list
      if (section.activityIds.includes(activityId)) {
        // Find the portion data for this activity
        const portion = section.activityPortions?.find((p) => p.activityId === activityId);

        matches.push({
          section,
          portion: portion as SectionPortion | undefined,
          direction: (portion?.direction as 'same' | 'reverse') || 'same',
          distance: portion?.distanceMeters || section.distanceMeters,
        });
      }
    }

    // Sort by visit count (most popular first)
    matches.sort((a, b) => b.section.visitCount - a.section.visitCount);

    return matches;
  }, [activityId, allSections]);

  return {
    sections,
    count: sections.length,
    isReady,
  };
}
