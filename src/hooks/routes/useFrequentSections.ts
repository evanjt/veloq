/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are auto-detected road sections that are frequently traveled,
 * even when the full routes differ.
 */

import { useMemo } from 'react';
import { useEngineSections } from './useRouteEngine';
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

  const { sections: rawSections, totalCount } = useEngineSections({ sportType, minVisits: 1 });
  const isReady = true;

  const sections = useMemo(() => {
    let filtered = rawSections.map(s => s as unknown as FrequentSection);

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
        filtered.sort((a, b) => (a.id).localeCompare(b.id));
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
