/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are auto-detected road sections that are frequently traveled,
 * even when the full routes differ.
 *
 * Uses lightweight SectionSummary for list views (no polyline/activity traces).
 * Full FrequentSection data is loaded on-demand via useSectionDetail.
 */

import { useMemo } from 'react';
import { useSectionSummaries } from './useRouteEngine';
import type { FrequentSection } from '@/types';
import type { SectionSummary } from 'veloqrs';

export interface UseFrequentSectionsOptions {
  /** Filter by sport type (e.g., "Run", "Ride") */
  sportType?: string;
  /** Minimum visit count to include */
  minVisits?: number;
  /** Sort order */
  sortBy?: 'visits' | 'distance' | 'name';
  /** Whether to run the hook (default: true). When false, returns empty defaults without FFI calls. */
  enabled?: boolean;
}

export interface UseFrequentSectionsResult {
  /** Filtered and sorted sections (lightweight - no polylines) */
  sections: FrequentSection[];
  /** Total number of sections (before filtering) */
  totalCount: number;
  /** Whether sections are ready (cache loaded) */
  isReady: boolean;
}

/**
 * Convert SectionSummary to FrequentSection-like object.
 * Polylines are lazy-loaded via useSectionPolyline in SectionRow.
 */
function summaryToFrequentSection(
  summary: SectionSummary
): FrequentSection & { activityCount: number } {
  return {
    id: summary.id,
    sectionType: summary.sectionType === 'custom' ? 'custom' : 'auto',
    name: summary.name,
    sportType: summary.sportType,
    polyline: [], // Lazy-loaded via useSectionPolyline
    activityIds: [], // Not needed for list view (count available in summary)
    routeIds: [], // Not needed for list view
    visitCount: summary.visitCount,
    distanceMeters: summary.distanceMeters,
    confidence: summary.confidence,
    activityCount: summary.activityCount, // Preserve for display
    createdAt: summary.createdAt,
  };
}

export function useFrequentSections(
  options: UseFrequentSectionsOptions = {}
): UseFrequentSectionsResult {
  const { sportType, minVisits = 3, sortBy = 'visits', enabled = true } = options;

  // Use lightweight summaries - no polylines loaded, queries SQLite on-demand
  // Rust already filters out disabled/superseded sections
  const { totalCount, summaries } = useSectionSummaries({
    sportType,
    minVisits: 1,
    enabled,
  });
  const isReady = true;

  const sections = useMemo(() => {
    if (!enabled) return [];
    let filtered = summaries.map(summaryToFrequentSection);

    if (sportType) {
      filtered = filtered.filter((s) => s.sportType === sportType);
    }

    filtered = filtered.filter((s) => s.visitCount >= minVisits);

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
  }, [summaries, sportType, minVisits, sortBy, enabled]);

  return {
    sections,
    totalCount,
    isReady,
  };
}
