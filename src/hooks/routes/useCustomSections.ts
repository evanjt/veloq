/**
 * Hook for managing user-created sections.
 * Uses unified sections table via Rust engine.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { computePolylineOverlap } from '@/lib/utils/geometry';
import { gpsPointsToRoutePoints, type GpsPoint } from 'veloqrs';
import { useSupersededSections } from '@/providers';
import type { Section, RoutePoint } from '@/types';

const QUERY_KEY = ['sections', 'custom'];

export interface UseCustomSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Whether to run the hook (default: true). When false, returns empty defaults without FFI calls. */
  enabled?: boolean;
}

export interface UseCustomSectionsResult {
  /** Custom sections */
  sections: Section[];
  /** Total count */
  count: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Create a new section */
  createSection: (params: CreateSectionParams) => Promise<Section>;
  /** Delete a section */
  removeSection: (sectionId: string) => Promise<void>;
  /** Rename a section */
  renameSection: (sectionId: string, name: string) => Promise<void>;
  /** Refresh the sections list */
  refresh: () => Promise<void>;
}

export interface CreateSectionParams {
  /** Start index in source activity */
  startIndex: number;
  /** End index in source activity */
  endIndex: number;
  /** Activity this section was created from */
  sourceActivityId: string;
  /** Sport type */
  sportType: string;
  /** Optional custom name (auto-generated if not provided) */
  name?: string;
}

/**
 * Overlap threshold for considering sections as superseded.
 * If a custom section overlaps >80% with an auto section, the auto section is hidden.
 */
const OVERLAP_THRESHOLD = 0.8;

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
 * Uses Rust engine unified sections table.
 */
export function useCustomSections(options: UseCustomSectionsOptions = {}): UseCustomSectionsResult {
  const { sportType, enabled = true } = options;
  const queryClient = useQueryClient();

  // Load custom sections from unified sections table
  const {
    data: rawSections,
    isLoading,
    error,
    refetch,
  } = useQuery<Section[]>({
    queryKey: QUERY_KEY,
    enabled,
    queryFn: async () => {
      const engine = getRouteEngine();
      if (!engine) {
        return [];
      }

      // Get custom sections from unified table
      const sections = engine.getSectionsByType('custom');

      // Convert polylines to RoutePoint format
      // Note: FfiSection doesn't have activityPortions - it's optional in the app type
      return sections.map((s) => ({
        ...s,
        polyline: gpsPointsToRoutePoints(s.polyline as unknown as GpsPoint[]),
        sectionType: 'custom' as const,
        createdAt: s.createdAt || new Date().toISOString(),
        // FfiSection doesn't have activityPortions
        activityPortions: undefined,
      })) as Section[];
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
    await queryClient.invalidateQueries({ queryKey: ['sections'] });
  }, [queryClient]);

  // Create a new section
  const createSection = useCallback(
    async (params: CreateSectionParams): Promise<Section> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      // Create section via unified FFI
      const sectionId = engine.createSectionFromIndices(
        params.sourceActivityId,
        params.startIndex,
        params.endIndex,
        params.sportType,
        params.name
      );

      if (!sectionId) {
        throw new Error('Failed to create section');
      }

      // Get the created section
      const section = engine.getSectionById(sectionId);
      if (!section) {
        throw new Error('Section created but could not be retrieved');
      }

      const result = {
        ...section,
        polyline: gpsPointsToRoutePoints(section.polyline as unknown as GpsPoint[]),
        sectionType: 'custom' as const,
        createdAt: section.createdAt || new Date().toISOString(),
        activityPortions: section.activityPortions?.map((p) => ({
          ...p,
          direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
        })),
      } as Section;

      if (__DEV__) {
        console.log(
          `[useCustomSections] Created section ${result.id} (${result.polyline.length} points, ${result.distanceMeters.toFixed(0)}m)`
        );
      }

      // Compute which auto-detected sections this custom section supersedes
      try {
        const autoSections = engine.getSectionsByType('auto');
        const autoSectionsForOverlap = autoSections.map((s) => ({
          id: s.id,
          polyline: gpsPointsToRoutePoints(s.polyline as unknown as GpsPoint[]),
        }));
        const supersededIds = findSupersededSections(result.polyline, autoSectionsForOverlap);
        if (supersededIds.length > 0) {
          await useSupersededSections.getState().setSuperseded(result.id, supersededIds);
          if (__DEV__) {
            console.log(
              `[useCustomSections] Custom section ${result.id} supersedes ${supersededIds.length} auto sections`
            );
          }
        }
      } catch (overlapError) {
        if (__DEV__) {
          console.warn('[useCustomSections] Failed to compute superseded sections:', overlapError);
        }
      }

      await invalidate();
      return result;
    },
    [invalidate]
  );

  // Delete a section
  const removeSection = useCallback(
    async (sectionId: string): Promise<void> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      engine.deleteSection(sectionId);

      // Remove superseded entries for this section
      await useSupersededSections.getState().removeSuperseded(sectionId);

      await invalidate();
    },
    [invalidate]
  );

  // Rename a section
  const renameSection = useCallback(
    async (sectionId: string, name: string): Promise<void> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      engine.setSectionName(sectionId, name);
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
    refresh,
  };
}

/**
 * Hook to get a single custom section by ID
 */
export function useCustomSection(sectionId: string | undefined): {
  section: Section | null;
  isLoading: boolean;
} {
  const { sections, isLoading } = useCustomSections();

  const section = useMemo(() => {
    if (!sectionId) return null;
    return sections.find((s) => s.id === sectionId) || null;
  }, [sections, sectionId]);

  return { section, isLoading };
}
