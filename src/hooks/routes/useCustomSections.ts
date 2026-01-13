/**
 * Hook for managing user-created custom sections.
 * Uses Rust engine as the single source of truth for storage and matching.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
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
  /** GPS points for the section */
  polyline: RoutePoint[];
  /** Start index in source activity */
  startIndex: number;
  /** End index in source activity */
  endIndex: number;
  /** Activity this section was created from */
  sourceActivityId: string;
  /** Sport type */
  sportType: string;
  /** Distance in meters */
  distanceMeters: number;
  /** Optional custom name (auto-generated if not provided) */
  name?: string;
}

/**
 * Generate a unique ID for a custom section
 */
function generateId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique section name
 */
function generateSectionName(existingNames: Set<string>): string {
  let index = 1;
  while (existingNames.has(`Custom Section ${index}`)) {
    index++;
  }
  return `Custom Section ${index}`;
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
          polyline: s.polyline,
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

  // Create a new section using Rust engine
  const createSection = useCallback(
    async (params: CreateSectionParams): Promise<CustomSection> => {
      const engine = getRouteEngine();
      if (!engine) {
        throw new Error('Route engine not initialized');
      }

      // Get existing names for unique name generation
      const existingSections = engine.getCustomSections();
      const existingNames = new Set(existingSections.map((s) => s.name));
      const name = params.name || generateSectionName(existingNames);

      const section: CustomSection = {
        id: generateId(),
        name,
        polyline: params.polyline,
        startIndex: params.startIndex,
        endIndex: params.endIndex,
        sourceActivityId: params.sourceActivityId,
        sportType: params.sportType,
        distanceMeters: params.distanceMeters,
        createdAt: new Date().toISOString(),
      };

      // Add to Rust engine (which handles storage and matching)
      const success = engine.addCustomSection(section);
      if (!success) {
        throw new Error('Failed to add custom section');
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
