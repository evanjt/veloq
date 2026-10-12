/**
 * Shared formatter for sync progress display across all banners.
 * Single source of truth for how GPS/route/bounds progress is rendered.
 */

import type { TFunction } from 'i18next';
import type { GpsSyncProgress } from '@/shared/app/SyncDateRangeStore';

export interface SyncDisplayInfo {
  icon: string;
  /** The whole line, punctuation and figure included: a banner prints it as it is. */
  text: string;
  percent: number;
  countText: string | null;
  indeterminate: boolean;
}

/**
 * A stage's line with the overall figure. The stage string carries its own
 * punctuation and never a number, so the line holds one percentage, and none
 * before there is progress to show.
 */
export function progressLine(stage: string, percent: number, t: TFunction): string {
  return percent > 0 ? (t('cache.stageProgress', { stage, percent }) as string) : stage;
}

/**
 * Format GPS sync progress (downloading tracks + analysing routes) for display.
 * Returns null when there's nothing to show (idle, error, a complete with nothing left running).
 */
export function formatGpsSyncProgress(
  progress: GpsSyncProgress,
  isFetchingActivities: boolean,
  t: TFunction
): SyncDisplayInfo | null {
  // Loading activities from API (no real progress yet)
  if (
    isFetchingActivities &&
    progress.status !== 'fetching' &&
    progress.status !== 'processing' &&
    progress.status !== 'computing'
  ) {
    return {
      icon: 'cloud-download-outline',
      text: t('mapScreen.loadingActivities') as string,
      percent: 0,
      countText: null,
      indeterminate: true,
    };
  }

  // The sync settled while Rust is still detecting: say so until it lands.
  if (progress.status === 'complete' && progress.analysingInBackground) {
    return {
      icon: 'map-marker-path',
      text: progress.message,
      percent: 0,
      countText: null,
      indeterminate: true,
    };
  }

  // Downloading GPS tracks
  if (progress.status === 'fetching') {
    return {
      icon: 'download-outline',
      text: progressLine(t('routesScreen.downloadingGps') as string, progress.percent, t),
      percent: progress.percent,
      countText: progress.total > 0 ? `${progress.completed}/${progress.total}` : null,
      indeterminate: progress.completed === 0 && progress.total === 0,
    };
  }

  // Analysing routes (section detection)
  if (progress.status === 'computing' || progress.status === 'processing') {
    // A caller's message names its stage (the heatmap pass, say) and drops the
    // count suffix, whose figures belong to the download.
    const hasCustomMessage = Boolean(progress.message);
    const stage = progress.message || (t('cache.analyzingRoutes') as string);
    return {
      icon: 'map-marker-path',
      text: progressLine(stage, progress.percent, t),
      percent: progress.percent,
      countText:
        !hasCustomMessage && progress.total > 0 ? `${progress.completed}/${progress.total}` : null,
      indeterminate: progress.percent === 0 && progress.completed === 0 && progress.total === 0,
    };
  }

  return null;
}
