/**
 * Shared formatter for sync progress display across all banners.
 * Single source of truth for how GPS/route/bounds progress is rendered.
 */

import type { TFunction } from 'i18next';
import type { GpsSyncProgress } from '@/providers/SyncDateRangeStore';

export interface SyncDisplayInfo {
  icon: string;
  text: string;
  percent: number;
  countText: string | null;
  indeterminate: boolean;
}

/**
 * Format GPS sync progress (downloading tracks + analysing routes) for display.
 * Returns null when there's nothing to show (idle, complete, error).
 */
export function formatGpsSyncProgress(
  progress: GpsSyncProgress,
  isFetchingActivities: boolean,
  t: TFunction
): SyncDisplayInfo | null {
  // Loading activities from API (no real progress yet)
  if (isFetchingActivities && progress.status === 'idle') {
    return {
      icon: 'cloud-download-outline',
      text: t('mapScreen.loadingActivities') as string,
      percent: 0,
      countText: null,
      indeterminate: true,
    };
  }

  // Downloading GPS tracks
  if (progress.status === 'fetching') {
    return {
      icon: 'download-outline',
      text: t('routesScreen.downloadingGps') as string,
      percent: progress.percent,
      countText: progress.total > 0 ? `${progress.completed}/${progress.total}` : null,
      indeterminate: progress.completed === 0 && progress.total === 0,
    };
  }

  // Analysing routes (section detection)
  if (progress.status === 'computing' || progress.status === 'processing') {
    return {
      icon: 'map-marker-path',
      text: t('cache.analyzingRoutes') as string,
      percent: progress.percent,
      countText: null,
      indeterminate: progress.percent === 0,
    };
  }

  return null;
}

/**
 * Format bounds sync progress (activity bounds cache sync) for display.
 * Returns null when there's nothing to show.
 */
export function formatBoundsSyncProgress(
  boundsProgress: { status: string; completed: number; total: number },
  t: TFunction
): SyncDisplayInfo | null {
  if (boundsProgress.status !== 'syncing') {
    return null;
  }

  const percent =
    boundsProgress.total > 0
      ? Math.round((boundsProgress.completed / boundsProgress.total) * 100)
      : 0;

  return {
    icon: 'cloud-sync-outline',
    text: t('cache.syncingActivities') as string,
    percent,
    countText:
      boundsProgress.total > 0 ? `${boundsProgress.completed}/${boundsProgress.total}` : null,
    indeterminate: false,
  };
}
