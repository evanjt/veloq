/**
 * Hook for accessing frequent sections from the route cache.
 * Sections are auto-detected road segments that are frequently traveled,
 * even when the full routes differ.
 */

import { useMemo } from 'react';
import { useRouteMatchStore } from '@/providers';
import type { FrequentSection } from '@/types';

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

  const cache = useRouteMatchStore((s) => s.cache);
  const isReady = cache !== null;

  const sections = useMemo(() => {
    if (!cache?.frequentSections) {
      return [];
    }

    let filtered = [...cache.frequentSections];

    // Filter by sport type
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
        filtered.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        break;
    }

    return filtered;
  }, [cache?.frequentSections, sportType, minVisits, sortBy]);

  return {
    sections,
    totalCount: cache?.frequentSections?.length || 0,
    isReady,
  };
}
