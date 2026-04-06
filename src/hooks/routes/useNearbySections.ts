/**
 * Hook for loading sections near a given section.
 * Returns summaries with polyline data for map overlay rendering.
 */

import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';
import type { NearbySectionSummary } from 'veloqrs';

interface UseNearbySectionsResult {
  nearby: NearbySectionSummary[];
  isLoading: boolean;
}

export function useNearbySections(
  sectionId: string | undefined,
  radiusMeters: number = 500
): UseNearbySectionsResult {
  const trigger = useEngineSubscription(['sections']);

  const nearby = useMemo(() => {
    if (!sectionId) return [];
    const engine = getRouteEngine();
    if (!engine) return [];
    return engine.getNearbySections(sectionId, radiusMeters);
  }, [sectionId, radiusMeters, trigger]);

  return { nearby, isLoading: false };
}
