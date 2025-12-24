/**
 * Hook for accessing route groups.
 * Provides filtered and sorted lists of route groups.
 */

import { useMemo } from 'react';
import { useRouteMatchStore } from '@/providers/RouteMatchStore';
import type { RouteGroup, ActivityType } from '@/types';

interface UseRouteGroupsOptions {
  /** Filter by activity type */
  type?: ActivityType;
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'recent' | 'name';
}

interface UseRouteGroupsResult {
  /** List of route groups */
  groups: RouteGroup[];
  /** Total number of groups (before filtering) */
  totalCount: number;
  /** Number of processed activities */
  processedCount: number;
  /** Whether the store is initialized */
  isReady: boolean;
}

export function useRouteGroups(options: UseRouteGroupsOptions = {}): UseRouteGroupsResult {
  const { type, minActivities = 2, sortBy = 'count' } = options;

  const cache = useRouteMatchStore((s) => s.cache);
  const isInitialized = useRouteMatchStore((s) => s.isInitialized);

  const result = useMemo(() => {
    if (!cache) {
      return {
        groups: [],
        totalCount: 0,
        processedCount: 0,
        isReady: isInitialized,
      };
    }

    let filtered = cache.groups;

    // Filter by type
    if (type) {
      filtered = filtered.filter((g) => g.type === type);
    }

    // Filter by minimum activities
    filtered = filtered.filter((g) => g.activityCount >= minActivities);

    // Sort
    const sorted = [...filtered];
    switch (sortBy) {
      case 'count':
        sorted.sort((a, b) => b.activityCount - a.activityCount);
        break;
      case 'recent':
        sorted.sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return {
      groups: sorted,
      totalCount: cache.groups.length,
      processedCount: cache.processedActivityIds.length,
      isReady: isInitialized,
    };
  }, [cache, type, minActivities, sortBy, isInitialized]);

  return result;
}
