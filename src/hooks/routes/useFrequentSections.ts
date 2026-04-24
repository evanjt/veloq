/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are auto-detected road sections that are frequently traveled,
 * even when the full routes differ.
 *
 * Uses lightweight SectionSummary for list views (no polyline/activity traces).
 * Full FrequentSection data is loaded on-demand via useSectionDetail.
 */

import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';
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
  const trigger = useEngineSubscription(['sections']);

  // Sport filter, visit-count threshold, and sort all happen in Rust.
  // TS only fills in display names for summaries without a stored name.
  const { sections, totalCount } = useMemo(() => {
    if (!enabled) return { sections: [], totalCount: 0 };
    const engine = getRouteEngine();
    if (!engine) return { sections: [], totalCount: 0 };

    try {
      const { totalCount, summaries: rawSummaries } = engine.getFilteredSectionSummaries(
        sportType,
        minVisits,
        sortBy
      );
      const named = rawSummaries.map((s: SectionSummary) => ({
        ...s,
        name: s.name || generateSectionName(s),
      }));
      return { sections: named.map(summaryToFrequentSection), totalCount };
    } catch {
      return { sections: [], totalCount: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, sportType, minVisits, sortBy, enabled]);

  return {
    sections,
    totalCount,
    isReady: true,
  };
}
