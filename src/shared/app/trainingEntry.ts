/**
 * Where the training tab opens when a card sends the athlete there.
 *
 * The tab read no params, so a link to the HRV it summarised opened at the
 * heatmap with the wellness chart below the fold.
 */

import { first } from '@/shared/app/fitnessEntry';

/** The charts on the training tab a link can open. */
export const TRAINING_CHARTS = ['hrv', 'rhr', 'weight', 'week'] as const;

export type TrainingChart = (typeof TRAINING_CHARTS)[number];

/** A card on the training tab. */
export type TrainingCard = 'wellness' | 'week';

/** The card that draws each chart: the wellness trends hold all three readings. */
export const TRAINING_CHART_CARD: Record<TrainingChart, TrainingCard> = {
  hrv: 'wellness',
  rhr: 'wellness',
  weight: 'wellness',
  week: 'week',
};

function isChart(value: string): value is TrainingChart {
  return (TRAINING_CHARTS as readonly string[]).includes(value);
}

/** The chart a set of route params asks for, or null for anything unknown. */
export function trainingEntryFromParams(params: { chart?: string | string[] }): {
  chart: TrainingChart | null;
} {
  const chart = first(params.chart);
  return { chart: chart && isChart(chart) ? chart : null };
}

/** The link a card uses to open the training tab on one chart. */
export function trainingTarget(chart: TrainingChart): string {
  return `/training?chart=${chart}`;
}
