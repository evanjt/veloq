/**
 * Hook for managing user-created custom sections.
 * Provides CRUD operations and React Query caching.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  loadCustomSections,
  loadCustomSectionsWithMatches,
  addCustomSection,
  updateCustomSection,
  deleteCustomSection,
  saveSectionMatches,
  generateSectionName,
} from '@/lib/storage/customSections';
import { getCachedActivityIds } from '@/lib/storage/gpsStorage';
import { matchCustomSection } from '@/lib/sectionMatcher';
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
 * Hook for managing custom sections with React Query caching.
 */
export function useCustomSections(options: UseCustomSectionsOptions = {}): UseCustomSectionsResult {
  const { includeMatches = true, sportType } = options;
  const queryClient = useQueryClient();

  // Load sections with React Query
  const {
    data: rawSections,
    isLoading,
    error,
    refetch,
  } = useQuery<CustomSectionWithMatches[]>({
    queryKey: [...QUERY_KEY, { includeMatches }],
    queryFn: async () => {
      if (includeMatches) {
        return loadCustomSectionsWithMatches();
      }
      // Load without matches - add empty matches array
      const sections = await loadCustomSections();
      return sections.map((s) => ({ ...s, matches: [] }));
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

  // Create a new section and match against cached activities
  // Matching is done BEFORE saving to avoid orphan sections
  const createSection = useCallback(
    async (params: CreateSectionParams): Promise<CustomSection> => {
      const name = params.name || (await generateSectionName());

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

      // Match against cached activities FIRST (before saving)
      let matches: CustomSectionMatch[] = [];
      try {
        const activityIds = await getCachedActivityIds();
        if (activityIds.length > 0) {
          matches = await matchCustomSection(section, activityIds);
        }
      } catch (error) {
        console.warn('Failed to match section against activities:', error);
        // Continue - we'll at least add the source activity as a match
      }

      // Ensure the source activity is always included as a match
      if (params.sourceActivityId) {
        const hasSourceMatch = matches.some((m) => m.activityId === params.sourceActivityId);
        if (!hasSourceMatch) {
          matches.push({
            activityId: params.sourceActivityId,
            direction: 'same',
            startIndex: params.startIndex,
            endIndex: params.endIndex,
          });
        }
      }

      // Now save the section and matches together
      await addCustomSection(section);
      if (matches.length > 0) {
        await saveSectionMatches(section.id, matches);
      }

      await invalidate();

      return section;
    },
    [invalidate]
  );

  // Delete a section
  const removeSection = useCallback(
    async (sectionId: string): Promise<void> => {
      await deleteCustomSection(sectionId);
      await invalidate();
    },
    [invalidate]
  );

  // Rename a section
  const renameSection = useCallback(
    async (sectionId: string, name: string): Promise<void> => {
      await updateCustomSection(sectionId, { name });
      await invalidate();
    },
    [invalidate]
  );

  // Update matches for a section
  const updateMatches = useCallback(
    async (sectionId: string, matches: CustomSectionMatch[]): Promise<void> => {
      await saveSectionMatches(sectionId, matches);
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
 * Generate a unique ID for a custom section
 */
function generateId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
