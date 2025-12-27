/**
 * Hook for route processing status and controls.
 * Used in settings and processing banner components.
 */

import { useCallback } from 'react';
import { useRouteMatchStore } from '@/providers/RouteMatchStore';
import { routeProcessingQueue } from '@/lib/routeProcessingQueue';
import type { RouteProcessingProgress, ActivityType, ActivityBoundsItem } from '@/types';

interface UseRouteProcessingResult {
  /** Current processing progress */
  progress: RouteProcessingProgress;
  /** Whether processing is currently active */
  isProcessing: boolean;
  /** Whether currently in filtering phase */
  isFiltering: boolean;
  /** Cancel current processing */
  cancel: () => void;
  /** Clear all route cache and start fresh */
  clearCache: () => Promise<void>;
  /** Queue activities for processing (with optional bounds for pre-filtering) */
  queueActivities: (
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>,
    boundsData?: ActivityBoundsItem[]
  ) => Promise<void>;
  /** Re-analyze all activities */
  reanalyzeAll: (
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>
  ) => Promise<void>;
}

export function useRouteProcessing(): UseRouteProcessingResult {
  const progress = useRouteMatchStore((s) => s.progress);
  const clearCacheAction = useRouteMatchStore((s) => s.clearCache);

  const isProcessing =
    progress.status === 'filtering' ||
    progress.status === 'fetching' ||
    progress.status === 'processing' ||
    progress.status === 'matching' ||
    progress.status === 'detecting-sections';

  const isFiltering = progress.status === 'filtering';

  const cancel = useCallback(() => {
    routeProcessingQueue.cancel();
  }, []);

  const queueActivities = useCallback(
    async (
      activityIds: string[],
      metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>,
      boundsData?: ActivityBoundsItem[]
    ) => {
      await routeProcessingQueue.queueActivities(activityIds, metadata, boundsData);
    },
    []
  );

  const reanalyzeAll = useCallback(
    async (
      activityIds: string[],
      metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>
    ) => {
      await routeProcessingQueue.reanalyzeAll(activityIds, metadata);
    },
    []
  );

  return {
    progress,
    isProcessing,
    isFiltering,
    cancel,
    clearCache: clearCacheAction,
    queueActivities,
    reanalyzeAll,
  };
}
