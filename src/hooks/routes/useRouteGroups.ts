/**
 * Hook for accessing route groups.
 * Provides filtered and sorted lists of route groups from the Rust engine.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import type { ActivityType } from '@/types';

interface UseRouteGroupsOptions {
  /** Filter by activity type */
  type?: ActivityType;
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'recent' | 'name';
  /** Filter routes by date range - only show routes with activities in this range */
  startDate?: Date;
  /** Filter routes by date range - only show routes with activities in this range */
  endDate?: Date;
}

interface RouteGroupExtended {
  /** Unique route ID (same as groupId, for compatibility) */
  id: string;
  /** Group ID from engine */
  groupId: string;
  /** Display name for the route */
  name: string;
  representativeId: string;
  activityIds: string[];
  sportType: string;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  activityCount: number;
  type: ActivityType;
  /** Route signature with points for mini-trace preview */
  signature?: { points: Array<{ lat: number; lng: number }>; distance: number } | null;
}

interface UseRouteGroupsResult {
  /** List of route groups */
  groups: RouteGroupExtended[];
  /** Total number of groups (before filtering) */
  totalCount: number;
  /** Number of processed activities */
  processedCount: number;
  /** Whether the store is initialized */
  isReady: boolean;
}

export function useRouteGroups(options: UseRouteGroupsOptions = {}): UseRouteGroupsResult {
  const { type, minActivities = 2, sortBy = 'count' } = options;

  const { groups: rawGroups, totalCount } = useEngineGroups({ minActivities: 1 });

  const result = useMemo(() => {
    // Convert engine groups to extended format
    // NOTE: Signature is NOT loaded here to avoid blocking render with sync FFI calls.
    // Use useConsensusRoute hook to load signature lazily when needed.
    const extended: RouteGroupExtended[] = rawGroups.map((g, index) => {
      const sportType = g.sportType || 'Ride';
      const activityCount = g.activityIds.length;

      // Use custom name from Rust engine if set, otherwise generate default
      const name = g.customName || `${sportType} Route ${index + 1}`;

      return {
        ...g,
        id: g.groupId, // Compatibility alias
        name,
        activityCount,
        type: sportType as ActivityType,
        // Signature loaded lazily via useConsensusRoute to avoid blocking render
        signature: undefined,
      };
    });

    let filtered = extended;

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
      case 'name':
        sorted.sort((a, b) => a.groupId.localeCompare(b.groupId));
        break;
      // 'recent' would require dates which aren't in the engine yet
      default:
        sorted.sort((a, b) => b.activityCount - a.activityCount);
    }

    return {
      groups: sorted,
      totalCount,
      processedCount: rawGroups.reduce((sum, g) => sum + g.activityIds.length, 0),
      isReady: true,
    };
  }, [rawGroups, type, minActivities, sortBy, totalCount]);

  return result;
}
