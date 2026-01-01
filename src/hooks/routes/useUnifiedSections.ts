/**
 * Unified sections hook that combines:
 * - Auto-detected sections from Rust engine
 * - User-created custom sections from FileSystem storage
 * - Potential sections for discovery (suggestions)
 */

import { useMemo } from 'react';
import { useFrequentSections } from './useFrequentSections';
import { useCustomSections } from './useCustomSections';
import type {
  FrequentSection,
  CustomSectionWithMatches,
  PotentialSection,
  UnifiedSection,
  RoutePoint,
} from '@/types';

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
 * Generate a display name for an auto-detected section.
 */
function generateSectionName(section: FrequentSection): string {
  if (section.name) return section.name;

  const distanceKm = section.distanceMeters / 1000;
  const distanceStr = distanceKm >= 1
    ? `${distanceKm.toFixed(1)}km`
    : `${Math.round(section.distanceMeters)}m`;

  return `${section.sportType} Section (${distanceStr})`;
}

/**
 * Compute overlap between two polylines.
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

  // Load auto-detected sections from engine
  const {
    sections: engineSections,
    isLoading: engineLoading,
    error: engineError,
  } = useFrequentSections({ sportType });

  // Load custom sections
  const {
    sections: customSections,
    isLoading: customLoading,
    error: customError,
  } = useCustomSections({ sportType, includeMatches: true });

  // TODO: Load potential sections from engine when available
  // For now, potentials will be empty until we wire up the multi-scale detection
  const potentialSections: PotentialSection[] = [];

  // Combine all sections
  const unified = useMemo(() => {
    const result: UnifiedSection[] = [];

    // Add custom sections first (user-created take priority)
    if (includeCustom) {
      for (const custom of customSections) {
        result.push({
          id: `custom_${custom.id}`,
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

    // Add auto-detected sections (excluding those that overlap with custom)
    for (const engine of engineSections) {
      // Check if there's a custom section that overlaps significantly
      const hasCustomOverlap = customSections.some(
        (c) => computePolylineOverlap(c.polyline, engine.polyline) > 0.8
      );

      if (!hasCustomOverlap) {
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
    if (includePotentials) {
      for (const potential of potentialSections) {
        // Check if there's already a similar section
        const hasOverlap = result.some(
          (s) => computePolylineOverlap(potential.polyline, s.polyline) > 0.8
        );

        if (!hasOverlap) {
          const distanceKm = potential.distanceMeters / 1000;
          const distanceStr = distanceKm >= 1
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
  }, [engineSections, customSections, potentialSections, includeCustom, includePotentials]);

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
    isLoading: engineLoading || customLoading,
    error: engineError || customError || null,
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
