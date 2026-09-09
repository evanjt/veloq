/**
 * Hook for loading sections near a given section.
 * Returns summaries with polyline data for map overlay rendering.
 */

import type { NearbySectionSummary } from 'veloqrs';

interface UseNearbySectionsResult {
  nearby: NearbySectionSummary[];
  isLoading: boolean;
}

/**
 * The neighbours come from `getSectionDetailData`, which the screen reads before
 * it mounts this hook.
 */
export function useNearbySections(nearby: NearbySectionSummary[]): UseNearbySectionsResult {
  return { nearby, isLoading: false };
}
