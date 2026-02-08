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
import { useDisabledSections } from '@/providers';
import type { FrequentSection } from '@/types';
import type { SectionSummary } from 'veloqrs';

export interface UseFrequentSectionsOptions {
  /** Filter by sport type (e.g., "Run", "Ride") */
  sportType?: string;
  /** Minimum visit count to include */
  minVisits?: number;
  /** Sort order */
  sortBy?: 'visits' | 'distance' | 'name';
  /** Exclude disabled sections (default: true) */
  excludeDisabled?: boolean;
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
 * Note: SectionSummary from veloqrs may not have sectionType/createdAt fields
 * (old PersistentEngine type vs new unified Section type).
 */
function summaryToFrequentSection(
  summary: SectionSummary
): FrequentSection & { activityCount: number } {
  // Handle both old and new SectionSummary types
  const summaryAny = summary as unknown as Record<string, unknown>;
  const sectionType =
    typeof summaryAny.sectionType === 'string'
      ? summaryAny.sectionType === 'custom'
        ? 'custom'
        : 'auto'
      : 'auto';
  const createdAt =
    typeof summaryAny.createdAt === 'string' ? summaryAny.createdAt : new Date().toISOString();

  return {
    id: summary.id,
    sectionType,
    name: summary.name,
    sportType: summary.sportType,
    polyline: [], // Lazy-loaded via useSectionPolyline
    activityIds: [], // Not needed for list view (count available in summary)
    routeIds: [], // Not needed for list view
    visitCount: summary.visitCount,
    distanceMeters: summary.distanceMeters,
    confidence: summary.confidence,
    activityCount: summary.activityCount, // Preserve for display
    createdAt,
  };
}

export function useFrequentSections(
  options: UseFrequentSectionsOptions = {}
): UseFrequentSectionsResult {
  const {
    sportType,
    minVisits = 3,
    sortBy = 'visits',
    excludeDisabled = true,
    enabled = true,
  } = options;

  // Use lightweight summaries - no polylines loaded, queries SQLite on-demand
  // Pass enabled to skip FFI calls when batch data is available
  const { count: totalCount, summaries } = useSectionSummaries({
    sportType,
    minVisits: 1,
    enabled,
  });
  const isReady = true;

  // Get disabled sections for filtering
  const disabledIds = useDisabledSections((s) => s.disabledIds);

  const sections = useMemo(() => {
    // Skip processing when disabled
    if (!enabled) return [];
    // Convert summaries to FrequentSection format
    let filtered = summaries.map(summaryToFrequentSection);

    // Filter by sport type (already done by useSectionSummaries, but double-check)
    if (sportType) {
      filtered = filtered.filter((s) => s.sportType === sportType);
    }

    // Filter by minimum visits
    filtered = filtered.filter((s) => s.visitCount >= minVisits);

    // Filter out disabled sections
    if (excludeDisabled) {
      filtered = filtered.filter((s) => !disabledIds.has(s.id));
    }

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
  }, [summaries, sportType, minVisits, sortBy, excludeDisabled, disabledIds, enabled]);

  return {
    sections,
    totalCount,
    isReady,
  };
}
