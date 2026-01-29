import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { UnifiedSection } from '@/types';

export function useSectionDetail(sectionId: string | null) {
  const {
    data: section,
    isLoading,
    error,
  } = useQuery<UnifiedSection | null>({
    queryKey: ['section', sectionId],
    queryFn: async () => {
      if (!sectionId) return null;

      const engine = getRouteEngine();
      if (!engine) return null;

      const sectionType = sectionId.startsWith('custom_') ? 'custom' : 'auto';
      const json = engine.getSectionsByTypeJson(sectionType);
      const sections = JSON.parse(json) as UnifiedSection[];

      return sections.find((s) => s.id === sectionId) || null;
    },
    enabled: !!sectionId,
    staleTime: 1000 * 60 * 5,
  });

  return { section, isLoading, error: error as Error | null };
}
