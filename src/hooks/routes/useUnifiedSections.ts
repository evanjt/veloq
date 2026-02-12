/**
 * Unified sections hook that combines:
 * - Auto-detected sections from Rust engine
 * - User-created custom sections from FileSystem storage
 * - Potential sections for discovery (suggestions)
 */

import { useMemo } from 'react';
import { useFrequentSections } from './useFrequentSections';
import { useCustomSections } from './useCustomSections';
import { usePotentialSections } from './usePotentialSections';
import { useSectionDismissals } from '@/providers/SectionDismissalsStore';
import { useSupersededSections, useDisabledSections } from '@/providers';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';
import { computePolylineOverlap } from '@/lib/utils/geometry';
import type { FrequentSection, UnifiedSection, RoutePoint } from '@/types';

// Re-export for backwards compatibility
export { generateSectionName } from '@/lib/utils/sectionNaming';

export interface UseUnifiedSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Include custom sections (default: true) */
  includeCustom?: boolean;
  /** Include potential sections (default: true) */
  includePotentials?: boolean;
  /** Whether to run the hook (default: true). When false, returns empty defaults without FFI calls. */
  enabled?: boolean;
  /** Pre-loaded engine sections from batch FFI call. When provided, skips useSectionSummaries FFI calls. */
  preloadedEngineSections?: FrequentSection[];
}

export interface UseUnifiedSectionsResult {
  /** All sections combined */
  sections: UnifiedSection[];
  /** Total section count */
  count: number;
  /** Auto-detected section count */
  autoCount: number;
  /** Custom section count */
  customCount: number;
  /** Potential section count */
  potentialCount: number;
  /** Disabled section count */
  disabledCount: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Hook for unified sections combining all section types.
 */
export function useUnifiedSections(
  options: UseUnifiedSectionsOptions = {}
): UseUnifiedSectionsResult {
  const {
    sportType,
    includeCustom = true,
    includePotentials = true,
    enabled = true,
    preloadedEngineSections,
  } = options;

  // Get pre-computed superseded sections (computed when custom sections are created)
  // NOTE: Select raw data, not the Set - calling getAllSuperseded() in selector
  // creates new Set on every render, causing infinite loop
  const supersededBy = useSupersededSections((s) => s.supersededBy);
  const supersededSet = useMemo(() => {
    const result = new Set<string>();
    for (const autoIds of Object.values(supersededBy)) {
      for (const id of autoIds) {
        result.add(id);
      }
    }
    return result;
  }, [supersededBy]);

  // Load auto-detected sections from engine
  // Pass excludeDisabled: false because we handle disabled sections ourselves (sort to bottom with visual indicator)
  // Skip FFI calls when preloaded engine sections are available from batch data
  const skipEngineFetch = !!preloadedEngineSections;
  const { sections: hookEngineSections } = useFrequentSections({
    sportType,
    excludeDisabled: false,
    enabled: enabled && !skipEngineFetch,
  });
  const engineSections = skipEngineFetch ? preloadedEngineSections! : hookEngineSections;

  // Load custom sections
  const {
    sections: customSections,
    isLoading: customLoading,
    error: customError,
  } = useCustomSections({ sportType, enabled });

  // Load potential sections from storage (pre-computed during GPS sync)
  const { potentials: rawPotentials } = usePotentialSections({ sportType, enabled });

  // Get dismissals
  const isDismissed = useSectionDismissals((s) => s.isDismissed);

  // Get disabled sections
  const disabledIds = useDisabledSections((s) => s.disabledIds);

  // Filter out dismissed potentials
  const potentialSections = useMemo(() => {
    return rawPotentials.filter((p) => !isDismissed(p.id));
  }, [rawPotentials, isDismissed]);

  // Combine all sections
  // NOTE: Overlap calculation for auto vs custom sections is pre-computed and stored
  // in SupersededSectionsStore when custom sections are created.
  // Overlap for potential sections is still computed here (less frequent, smaller dataset).
  const unified = useMemo(() => {
    const result: UnifiedSection[] = [];
    const seenIds = new Set<string>(); // Track IDs to prevent duplicates

    // Add custom sections first (user-created take priority)
    // Note: custom.id already has "custom_" prefix from generateId()
    if (includeCustom) {
      for (const custom of customSections) {
        if (seenIds.has(custom.id)) continue;
        seenIds.add(custom.id);
        result.push({
          id: custom.id,
          sectionType: 'custom',
          name: custom.name || '',
          polyline: custom.polyline,
          sportType: custom.sportType,
          distanceMeters: custom.distanceMeters,
          activityIds: custom.activityIds || [],
          visitCount: custom.visitCount || custom.activityIds?.length || 1,
          createdAt: custom.createdAt || new Date().toISOString(),
        });
      }
    }

    // Add engine sections (auto-detected and custom from batch data)
    // Superseded list is pre-computed when custom sections are created
    // Note: engineSections now use lightweight summaries (empty polyline/activityIds)
    // Polylines are lazy-loaded via useSectionPolyline in SectionRow
    for (const engine of engineSections) {
      if (seenIds.has(engine.id)) continue;

      // Determine actual section type from data or ID prefix
      const actualType =
        engine.sectionType === 'custom' || engine.id.startsWith('custom_') ? 'custom' : 'auto';

      // Use pre-computed superseded list (instant lookup instead of O(n²) overlap calculation)
      if (!supersededSet.has(engine.id)) {
        seenIds.add(engine.id);
        result.push({
          ...engine,
          sectionType: actualType,
          name: engine.name || generateSectionName(engine),
          activityIds: engine.activityIds || [],
          createdAt: engine.createdAt || new Date().toISOString(),
        });
      }
    }

    // Add potential sections (suggestions)
    // Overlap check for potentials is still computed here (smaller dataset, less frequent)
    if (includePotentials) {
      for (const potential of potentialSections) {
        // Skip if we already have this ID
        if (seenIds.has(potential.id)) continue;

        // Check if there's already a similar section (by polyline overlap)
        // This is computed on-demand but potentials are rare and the result set is small
        const hasOverlap = result.some(
          (s) => computePolylineOverlap(potential.polyline, s.polyline) > 0.8
        );

        if (!hasOverlap) {
          seenIds.add(potential.id);
          const distanceKm = potential.distanceMeters / 1000;
          const distanceStr =
            distanceKm >= 1
              ? `${distanceKm.toFixed(1)}km`
              : `${Math.round(potential.distanceMeters)}m`;

          result.push({
            id: potential.id,
            sectionType: 'potential',
            name: `Suggested: ${potential.sportType} (${distanceStr})`,
            polyline: potential.polyline,
            sportType: potential.sportType,
            distanceMeters: potential.distanceMeters,
            activityIds: potential.activityIds || [],
            visitCount: potential.visitCount,
            createdAt: new Date().toISOString(),
            confidence: potential.confidence,
            scale: potential.scale,
          });
        }
      }
    }

    // Sort: disabled sections last, then by type (custom > auto > potential), then by visit count
    result.sort((a, b) => {
      // Disabled sections go to the bottom
      const aDisabled = disabledIds.has(a.id);
      const bDisabled = disabledIds.has(b.id);
      if (aDisabled && !bDisabled) return 1;
      if (!aDisabled && bDisabled) return -1;

      // Type priority
      const typePriority: Record<string, number> = { custom: 0, auto: 1, potential: 2 };
      const aPriority = typePriority[a.sectionType] ?? 1;
      const bPriority = typePriority[b.sectionType] ?? 1;

      if (aPriority !== bPriority) return aPriority - bPriority;

      // Then by visit count
      return b.visitCount - a.visitCount;
    });

    return result;
  }, [
    engineSections,
    customSections,
    potentialSections,
    includeCustom,
    includePotentials,
    supersededSet,
    disabledIds,
  ]);

  // Compute counts
  const autoCount = unified.filter(
    (s) => s.sectionType === 'auto' && !disabledIds.has(s.id)
  ).length;
  const customCount = unified.filter((s) => s.sectionType === 'custom').length;
  const potentialCount = unified.filter((s) => s.sectionType === 'potential').length;
  const disabledCount = unified.filter((s) => disabledIds.has(s.id)).length;

  return {
    sections: unified,
    count: unified.length,
    autoCount,
    customCount,
    potentialCount,
    disabledCount,
    isLoading: customLoading,
    error: customError || null,
  };
}

/**
 * Hook to get a single unified section by ID.
 */
export function useUnifiedSection(sectionId: string | undefined): {
  section: UnifiedSection | null;
  isLoading: boolean;
} {
  const { sections, isLoading } = useUnifiedSections();

  const section = useMemo(() => {
    if (!sectionId) return null;
    return sections.find((s) => s.id === sectionId) || null;
  }, [sections, sectionId]);

  return { section, isLoading };
}

/**
 * Get all section display names (custom or auto-generated).
 * Used for uniqueness validation when renaming sections.
 * Returns a map of sectionId -> displayName for all sections.
 *
 * Uses getSectionSummaries() instead of getSections() for better performance -
 * summaries contain all fields needed for name generation without loading full polylines.
 */
export function getAllSectionDisplayNames(): Record<string, string> {
  const engine = getRouteEngine();
  if (!engine) return {};

  // Use summaries instead of full sections - faster since no polyline data
  const summaries = engine.getSectionSummaries();
  const customNames = engine.getAllSectionNames();
  const result: Record<string, string> = {};

  for (const summary of summaries) {
    // Use custom name if set, otherwise use name from section or generate one
    if (customNames[summary.id]) {
      result[summary.id] = customNames[summary.id];
    } else if (summary.name) {
      result[summary.id] = summary.name;
    } else {
      result[summary.id] = generateSectionName(summary);
    }
  }

  return result;
}
