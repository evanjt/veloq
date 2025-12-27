/**
 * Hook for getting sections that an activity belongs to.
 * Used to display matched sections in the activity detail view.
 */

import { useMemo } from 'react';
import { useRouteMatchStore } from '@/providers/RouteMatchStore';
import type { FrequentSection, SectionPortion } from '@/types';

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
  const cache = useRouteMatchStore((s) => s.cache);
  const isReady = cache !== null;

  const sections = useMemo(() => {
    if (!activityId || !cache?.frequentSections) {
      return [];
    }

    const matches: SectionMatch[] = [];

    for (const section of cache.frequentSections) {
      // Check if activity is in this section's activity list
      if (section.activityIds.includes(activityId)) {
        // Find the portion data for this activity
        const portion = section.activityPortions?.find((p) => p.activityId === activityId);

        matches.push({
          section,
          portion,
          direction: (portion?.direction as 'same' | 'reverse') || 'same',
          distance: portion?.distanceMeters || section.distanceMeters,
        });
      }
    }

    // Sort by visit count (most popular first)
    matches.sort((a, b) => b.section.visitCount - a.section.visitCount);

    return matches;
  }, [activityId, cache?.frequentSections]);

  return {
    sections,
    count: sections.length,
    isReady,
  };
}
