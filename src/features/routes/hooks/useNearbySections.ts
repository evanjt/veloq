/**
 * Hook for loading sections near a given section.
 * Returns summaries with polyline data for map overlay rendering.
 */

import { useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from './useEngine';
import type { NearbySectionSummary } from 'veloqrs';

interface UseNearbySectionsResult {
  nearby: NearbySectionSummary[];
  isLoading: boolean;
}

/**
 * `preComputed` lets a caller that already read the neighbours as part of a
 * screen bundle skip this hook's own FFI call.
 */
export function useNearbySections(
  sectionId: string | undefined,
  radiusMeters: number = 500,
  preComputed?: NearbySectionSummary[]
): UseNearbySectionsResult {
  const trigger = useEngineSubscription(['sections']);

  const nearby = useMemo(() => {
    if (preComputed) return preComputed;
    if (!sectionId) return [];
    const engine = getEngine();
    if (!engine) return [];
    return engine.getNearbySections(sectionId, radiusMeters);
  }, [sectionId, radiusMeters, trigger, preComputed]);

  return { nearby, isLoading: false };
}
