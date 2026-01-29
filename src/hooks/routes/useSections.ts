import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { UnifiedSection } from '@/types';

export interface UseSectionsOptions {
  sectionType?: 'auto' | 'custom' | undefined;
  minVisits?: number;
  includeMatches?: boolean;
}

export interface UseSectionsResult {
  sections: UnifiedSection[];
  count: number;
  isLoading: boolean;
  error: Error | null;
  createSection: (params: CreateSectionParams) => Promise<string>;
  renameSection: (sectionId: string, name: string) => Promise<void>;
  refresh: () => void;
}

export function useSections(options: UseSectionsOptions = {}): UseSectionsResult {
  const { sectionType, minVisits = 1, includeMatches = true } = options;
  const queryClient = useQueryClient();

  const {
    data: sections = [],
    isLoading,
    error,
    refetch,
  } = useQuery<UnifiedSection[]>({
    queryKey: ['sections', { sectionType }],
    queryFn: async () => {
      const engine = getRouteEngine();
      if (!engine) return [];

      const json = engine.getSectionsByTypeJson(sectionType || undefined);
      if (!json || json === '[]') return [];

      return JSON.parse(json) as UnifiedSection[];
    },
    staleTime: 1000 * 60 * 5,
  });

  const filtered = useMemo(() => {
    if (!sections) return [];

    let result = [...sections];

    if (minVisits > 1) {
      result = result.filter((s) => s.visitCount >= minVisits);
    }

    result.sort((a, b) => {
      const aPriority = a.id.startsWith('custom_') ? 0 : 1;
      const bPriority = b.id.startsWith('custom_') ? 0 : 1;

      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.visitCount - a.visitCount;
    });

    return result;
  }, [sections, minVisits]);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['sections'] });
  }, [queryClient]);

  const createSection = useCallback(
    async (params: CreateSectionParams): Promise<string> => {
      const engine = getRouteEngine();
      if (!engine) throw new Error('Route engine not initialized');

      const id = engine.createSectionUnified({
        sportType: params.sportType,
        polylineJson: JSON.stringify(params.polyline),
        distanceMeters: params.distanceMeters,
        name: params.name,
        sourceActivityId: params.sourceActivityId,
      });

      await invalidate();
      return id;
    },
    [invalidate]
  );

  const renameSection = useCallback(
    async (sectionId: string, name: string): Promise<void> => {
      const engine = getRouteEngine();
      if (!engine) throw new Error('Route engine not initialized');

      engine.setSectionName(sectionId, name);
      await invalidate();
    },
    [invalidate]
  );

  return {
    sections: filtered,
    count: filtered.length,
    isLoading,
    error: error as Error | null,
    createSection,
    renameSection,
    refresh: refetch,
  };
}

export interface CreateSectionParams {
  sportType: string;
  polyline: RoutePoint[];
  distanceMeters: number;
  name?: string;
  sourceActivityId?: string;
}
