/**
 * Where each summary card metric opens. One table for the hero and the
 * supporting row, so a metric reads the same destination wherever it sits,
 * and a `MetricId` added without a row here fails to compile.
 */

import type { MetricId } from '@/features/home/store';
import { fitnessTarget } from '@/shared/app/fitnessEntry';
import { trainingTarget } from '@/shared/app/trainingEntry';

const TARGETS: Record<MetricId, string> = {
  fitness: fitnessTarget({ chart: 'fitness' }),
  form: fitnessTarget({ chart: 'form' }),
  ftp: fitnessTarget({ chart: 'ftp' }),
  thresholdPace: fitnessTarget({ chart: 'pace' }),
  css: fitnessTarget({ chart: 'css' }),
  hrv: trainingTarget('hrv'),
  rhr: trainingTarget('rhr'),
  weight: trainingTarget('weight'),
  weekHours: trainingTarget('week'),
  weekCount: trainingTarget('week'),
};

/** The route and chart a tap on `metric` opens. */
export function summaryCardTarget(metric: MetricId): string {
  return TARGETS[metric];
}
