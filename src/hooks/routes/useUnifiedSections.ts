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
import { useSupersededSections } from '@/providers';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { FrequentSection, UnifiedSection, RoutePoint } from '@/types';

export interface UseUnifiedSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Include custom sections (default: true) */
  includeCustom?: boolean;
  /** Include potential sections (default: true) */
  includePotentials?: boolean;
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
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Generate a display name for a section.
 * Checks Rust engine first (authoritative source), then falls back to section.name,
 * finally generates a name from sport type and distance.
 */
function generateSectionName(section: FrequentSection): string {
  // Check Rust engine for custom name first (authoritative source)
  const engine = getRouteEngine();
  if (engine) {
    const rustName = engine.getSectionName(section.id);
    if (rustName) return rustName;
  }

  // Fall back to section.name if present
  if (section.name) return section.name;

  // Auto-generate from sport type and distance
  const distanceKm = section.distanceMeters / 1000;
  const distanceStr =
    distanceKm >= 1 ? `${distanceKm.toFixed(1)}km` : `${Math.round(section.distanceMeters)}m`;

  return `${section.sportType} Section (${distanceStr})`;
}

/**
 * Compute overlap between two polylines.
 * Only used for potential sections (not for custom/auto overlap which is pre-computed).
 * Returns 0-1 representing the fraction of overlap.
 */
function computePolylineOverlap(
  polylineA: RoutePoint[],
  polylineB: RoutePoint[],
  threshold = 50 // meters
): number {
  if (polylineA.length === 0 || polylineB.length === 0) return 0;

  const R = 6371000; // Earth radius in meters

  let matchedCount = 0;
  for (const pointA of polylineA) {
    for (const pointB of polylineB) {
      // Simplified Haversine
      const dLat = ((pointB.lat - pointA.lat) * Math.PI) / 180;
      const dLon = ((pointB.lng - pointA.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((pointA.lat * Math.PI) / 180) *
          Math.cos((pointB.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      if (distance <= threshold) {
        matchedCount++;
        break; // This point matches, move to next
      }
    }
  }

  return matchedCount / polylineA.length;
}

/**
 * Hook for unified sections combining all section types.
 */
export function useUnifiedSections(
  options: UseUnifiedSectionsOptions = {}
): UseUnifiedSectionsResult {
  const { sportType, includeCustom = true, includePotentials = true } = options;

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
  const { sections: engineSections } = useFrequentSections({ sportType });

  // Load custom sections
  const {
    sections: customSections,
    isLoading: customLoading,
    error: customError,
  } = useCustomSections({ sportType, includeMatches: true });

  // Load potential sections from storage (pre-computed during GPS sync)
  const { potentials: rawPotentials } = usePotentialSections({ sportType });

  // Get dismissals
  const isDismissed = useSectionDismissals((s) => s.isDismissed);

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
          name: custom.name,
          polyline: custom.polyline,
          sportType: custom.sportType,
          distanceMeters: custom.distanceMeters,
          visitCount: custom.matches.length + 1, // +1 for source activity
          source: 'custom',
          customData: custom,
        });
      }
    }

    // Add auto-detected sections (excluding those superseded by custom sections)
    // Superseded list is pre-computed when custom sections are created
    for (const engine of engineSections) {
      if (seenIds.has(engine.id)) continue;

      // Use pre-computed superseded list (instant lookup instead of O(n²) overlap calculation)
      if (!supersededSet.has(engine.id)) {
        seenIds.add(engine.id);
        result.push({
          id: engine.id,
          name: generateSectionName(engine),
          polyline: engine.polyline,
          sportType: engine.sportType,
          distanceMeters: engine.distanceMeters,
          visitCount: engine.visitCount,
          source: 'auto',
          engineData: engine,
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
            name: `Suggested: ${potential.sportType} (${distanceStr})`,
            polyline: potential.polyline,
            sportType: potential.sportType,
            distanceMeters: potential.distanceMeters,
            visitCount: potential.visitCount,
            source: 'potential',
            potentialData: potential,
          });
        }
      }
    }

    // Sort by visit count (most visited first), then by source (custom > auto > potential)
    result.sort((a, b) => {
      // Source priority
      const sourcePriority = { custom: 0, auto: 1, potential: 2 };
      const aPriority = sourcePriority[a.source];
      const bPriority = sourcePriority[b.source];

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
  ]);

  // Compute counts
  const autoCount = unified.filter((s) => s.source === 'auto').length;
  const customCount = unified.filter((s) => s.source === 'custom').length;
  const potentialCount = unified.filter((s) => s.source === 'potential').length;

  return {
    sections: unified,
    count: unified.length,
    autoCount,
    customCount,
    potentialCount,
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
