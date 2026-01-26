/**
 * Hook for managing user-created custom sections.
 * Uses Rust engine as the single source of truth for storage and matching.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { gpsPointsToRoutePoints, type GpsPoint } from 'veloqrs';
import { useSupersededSections } from '@/providers';
import type {
  CustomSection,
  CustomSectionMatch,
  CustomSectionWithMatches,
  RoutePoint,
} from '@/types';

const QUERY_KEY = ['customSections'];

export interface UseCustomSectionsOptions {
  /** Include activity matches with sections */
  includeMatches?: boolean;
  /** Filter by sport type */
  sportType?: string;
}

export interface UseCustomSectionsResult {
  /** Custom sections (with or without matches based on options) */
  sections: CustomSectionWithMatches[];
  /** Total count */
  count: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Create a new custom section */
  createSection: (params: CreateSectionParams) => Promise<CustomSection>;
  /** Delete a custom section */
  removeSection: (sectionId: string) => Promise<void>;
  /** Rename a custom section */
  renameSection: (sectionId: string, name: string) => Promise<void>;
  /** Update matches for a section */
  updateMatches: (sectionId: string, matches: CustomSectionMatch[]) => Promise<void>;
  /** Refresh the sections list */
  refresh: () => Promise<void>;
}

export interface CreateSectionParams {
  /** GPS points for the section (DEPRECATED - Rust loads from SQLite via indices) */
  polyline?: RoutePoint[];
  /** Start index in source activity */
  startIndex: number;
  /** End index in source activity */
  endIndex: number;
  /** Activity this section was created from */
  sourceActivityId: string;
  /** Sport type */
  sportType: string;
  /** Distance in meters (optional - calculated by Rust if not provided) */
  distanceMeters?: number;
  /** Optional custom name (auto-generated if not provided) */
  name?: string;
}

/**
 * Overlap threshold for considering sections as superseded.
 * If a custom section overlaps >80% with an auto section, the auto section is hidden.
 */
const OVERLAP_THRESHOLD = 0.8;

/**
 * Compute overlap between two polylines.
 * Returns 0-1 representing the fraction of polylineA points that are close to polylineB.
 */
function computePolylineOverlap(
  polylineA: RoutePoint[],
  polylineB: RoutePoint[],
  thresholdMeters = 50
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

      if (distance <= thresholdMeters) {
        matchedCount++;
        break; // This point matches, move to next
      }
    }
  }

  return matchedCount / polylineA.length;
}

/**
 * Find auto-detected sections that significantly overlap with a custom section.
 */
function findSupersededSections(
  customPolyline: RoutePoint[],
  autoSections: Array<{ id: string; polyline: RoutePoint[] }>
): string[] {
  const superseded: string[] = [];

  for (const autoSection of autoSections) {
    const overlap = computePolylineOverlap(autoSection.polyline, customPolyline);
    if (overlap > OVERLAP_THRESHOLD) {
      superseded.push(autoSection.id);
    }
  }

  return superseded;
}

/**
 * Hook for managing custom sections with React Query caching.
 * Uses Rust engine as the single source of truth.
 */
export function useCustomSections(options: UseCustomSectionsOptions = {}): UseCustomSectionsResult {
  const { includeMatches = true, sportType } = options;
  const queryClient = useQueryClient();

  // Load sections from Rust engine with React Query
  const {
    data: rawSections,
    isLoading,
    error,
    refetch,
  } = useQuery<CustomSectionWithMatches[]>({
    queryKey: [...QUERY_KEY, { includeMatches }],
    queryFn: async () => {
      const engine = getRouteEngine();
      if (!engine) {
        return [];
      }

      // Get all custom sections from Rust engine
      const sections = engine.getCustomSections();

      // Convert to CustomSectionWithMatches format
      return sections.map((s): CustomSectionWithMatches => {
        // Get matches if requested
        const rawMatches = includeMatches ? engine.getCustomSectionMatches(s.id) : [];
        // Convert direction from string to union type
        const matches: CustomSectionMatch[] = rawMatches.map((m) => ({
          activityId: m.activityId,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
          direction: m.direction as 'same' | 'reverse',
          distanceMeters: m.distanceMeters,
        }));
        return {
          id: s.id,
          name: s.name,
          // Rust JSON returns GpsPoint format (latitude/longitude), convert to RoutePoint (lat/lng)
          polyline: gpsPointsToRoutePoints(s.polyline as unknown as GpsPoint[]),
          startIndex: s.startIndex,
          endIndex: s.endIndex,
          sourceActivityId: s.sourceActivityId,
          sportType: s.sportType,
          distanceMeters: s.distanceMeters,
          createdAt: s.createdAt,
          matches,
        };
      });
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Filter and sort sections
  const sections = useMemo(() => {
    let filtered = rawSections || [];

    // Filter by sport type if specified
    if (sportType) {
      filtered = filtered.filter((s) => s.sportType === sportType);
    }

    // Sort by creation date (newest first)
    filtered = [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return filtered;
  }, [rawSections, sportType]);

  // Invalidate queries after mutations
  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  // Create a new section using Rust engine (index-based - no coordinate transfer)
  const createSection = useCallback(
    async (params: CreateSectionParams): Promise<CustomSection> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      // Use index-based creation - Rust loads GPS track from SQLite internally
      // This eliminates ~100KB polyline transfer across FFI boundary
      const rustSection = engine.createSectionFromIndices(
        params.sourceActivityId,
        params.startIndex,
        params.endIndex,
        params.sportType,
        params.name
      );

      if (!rustSection) {
        throw new Error('Failed to create section');
      }

      if (__DEV__) {
        console.log(
          `[useCustomSections] Created section ${rustSection.id} (${rustSection.polyline.length} points, ${rustSection.distanceMeters.toFixed(0)}m)`
        );
      }

      // Convert GpsPoint polyline to RoutePoint format for app use
      const section: CustomSection = {
        ...rustSection,
        polyline: gpsPointsToRoutePoints(rustSection.polyline as unknown as GpsPoint[]),
      };

      // Compute which auto-detected sections this custom section supersedes
      // This pre-computation avoids expensive overlap calculations during UI navigation
      try {
        const autoSections = engine.getSections();
        // Convert GpsPoint polylines to RoutePoint for overlap calculation
        const autoSectionsForOverlap = autoSections.map((s) => ({
          id: s.id,
          polyline: gpsPointsToRoutePoints(s.polyline),
        }));
        const supersededIds = findSupersededSections(section.polyline, autoSectionsForOverlap);
        if (supersededIds.length > 0) {
          await useSupersededSections.getState().setSuperseded(section.id, supersededIds);
          if (__DEV__) {
            console.log(
              `[useCustomSections] Custom section ${section.id} supersedes ${supersededIds.length} auto sections`
            );
          }
        }
      } catch (overlapError) {
        // Don't fail section creation if overlap computation fails
        if (__DEV__) {
          console.warn('[useCustomSections] Failed to compute superseded sections:', overlapError);
        }
      }

      await invalidate();
      return section;
    },
    [invalidate]
  );

  // Delete a section using Rust engine
  const removeSection = useCallback(
    async (sectionId: string): Promise<void> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      engine.removeCustomSection(sectionId);

      // Remove superseded entries for this custom section
      await useSupersededSections.getState().removeSuperseded(sectionId);

      await invalidate();
    },
    [invalidate]
  );

  // Rename a section using Rust engine
  const renameSection = useCallback(
    async (sectionId: string, name: string): Promise<void> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      // Use Rust engine as the single source of truth for names
      engine.setSectionName(sectionId, name);
      await invalidate();
    },
    [invalidate]
  );

  // Update matches - trigger re-matching in Rust
  const updateMatches = useCallback(
    async (sectionId: string, _matches: CustomSectionMatch[]): Promise<void> => {
      // Matches are managed by Rust engine, just invalidate cache
      // The Rust engine automatically manages matches
      await invalidate();
    },
    [invalidate]
  );

  // Refresh
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    sections,
    count: sections.length,
    isLoading,
    error: error as Error | null,
    createSection,
    removeSection,
    renameSection,
    updateMatches,
    refresh,
  };
}

/**
 * Hook to get a single custom section by ID
 */
export function useCustomSection(sectionId: string | undefined): {
  section: CustomSectionWithMatches | null;
  isLoading: boolean;
} {
  const { sections, isLoading } = useCustomSections({ includeMatches: true });

  const section = useMemo(() => {
    if (!sectionId) return null;
    return sections.find((s) => s.id === sectionId) || null;
  }, [sections, sectionId]);

  return { section, isLoading };
}
