/**
 * Where each summary card metric opens. One table for the hero and the
 * supporting row, so a metric reads the same destination wherever it sits,
 * and a `MetricId` added without a row here fails to compile.
 */

import type { MetricId } from '@/features/settings';
import { fitnessTarget } from '@/shared/app/fitnessEntry';

const TARGETS: Record<MetricId, string> = {
  fitness: fitnessTarget({ chart: 'fitness' }),
  form: fitnessTarget({ chart: 'form' }),
  ftp: fitnessTarget({ chart: 'ftp' }),
  thresholdPace: fitnessTarget({ chart: 'pace' }),
  css: fitnessTarget({ chart: 'css' }),
  hrv: fitnessTarget({ chart: 'hrv' }),
  rhr: fitnessTarget({ chart: 'rhr' }),
  weight: fitnessTarget({ chart: 'weight' }),
  weekHours: fitnessTarget({ chart: 'week' }),
  weekCount: fitnessTarget({ chart: 'week' }),
};

/** The route and chart a tap on `metric` opens. */
export function summaryCardTarget(metric: MetricId): string {
  return TARGETS[metric];
}
