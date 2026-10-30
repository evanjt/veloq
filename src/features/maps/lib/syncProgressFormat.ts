/**
 * Shared formatter for sync progress display across all banners.
 * Single source of truth for how GPS/route/bounds progress is rendered.
 */

import type { TFunction } from 'i18next';
import { TrackStep, type TrackStage } from 'veloqrs';

export interface SyncDisplayInfo {
  icon: string;
  /** The whole line, punctuation and figure included: a banner prints it as it is. */
  text: string;
  percent: number;
  countText: string | null;
  indeterminate: boolean;
}

/**
 * A stage's line with its figure. The stage string carries its own
 * punctuation and never a number, so the line holds one percentage, and none
 * before there is progress to show.
 */
export function progressLine(stage: string, percent: number, t: TFunction): string {
  return percent > 0 ? (t('cache.stageProgress', { stage, percent }) as string) : stage;
}

/** How each step of the track work is drawn: its icon and the key naming it. */
const TRACK_STEPS = {
  [TrackStep.Downloading]: { icon: 'download-outline', stageKey: 'routesScreen.downloadingGps' },
  [TrackStep.Analysing]: { icon: 'map-marker-path', stageKey: 'cache.analyzingRoutes' },
  [TrackStep.DrawingHeatmap]: { icon: 'map-marker-path', stageKey: 'cache.finalizingHeatmap' },
} as const satisfies Record<Exclude<TrackStep, TrackStep.Held>, { icon: string; stageKey: string }>;

/**
 * The line for the track work the engine reports: the GPS download, section
 * detection or the heatmap pass. The percent is the stage's own, and only the
 * download carries a count, since its items are the tracks the athlete is
 * waiting for. Detection weights its phases, so it has a figure before its
 * items are counted and is indeterminate only before its first. A download
 * the request budget or intervals.icu holds back has no line: the wait is
 * routine, so nothing stands on screen until downloading resumes.
 */
export function formatTrackStage(stage: TrackStage, t: TFunction): SyncDisplayInfo | null {
  if (stage.step === TrackStep.Held) return null;
  const { icon, stageKey } = TRACK_STEPS[stage.step];
  const downloading = stage.step === TrackStep.Downloading;
  return {
    icon,
    text: progressLine(t(stageKey) as string, stage.percent, t),
    percent: stage.percent,
    countText: downloading && stage.total > 0 ? `${stage.completed}/${stage.total}` : null,
    indeterminate: stage.step === TrackStep.Analysing ? stage.percent === 0 : stage.total === 0,
  };
}
