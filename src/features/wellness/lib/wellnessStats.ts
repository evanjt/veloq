import type { WellnessData } from '@/types';

import { baselineOnOrBefore } from './wellnessBaseline';
import { trendArrow, trendOfMetric, type TrendMetric } from '@/shared/format/trend';

export type Trend = '↑' | '↓' | '';

export interface WellnessStats {
  fitness: number;
  fitnessTrend: Trend;
  form: number;
  formTrend: Trend;
  hrv: number | null;
  hrvTrend: Trend;
  rhr: number | null;
  rhrTrend: Trend;
  weight: number | null;
  weightTrend: Trend;
}

const trainingLoad = (row: WellnessData) => row.ctl ?? row.ctlLoad;

function trend(current: number | null, previous: number | null, metric: TrendMetric): Trend {
  return trendArrow(trendOfMetric(metric, current, previous));
}

/**
 * The summary card's five numbers and the arrow beside each. Weight moves too
 * little day to day to read, so it is compared against a week back; the rest
 * against the day before. An arrow is withheld whenever no row sits close
 * enough to the day it would stand for.
 */
export function computeWellnessStats(wellness: WellnessData[] | undefined): WellnessStats {
  const sorted = wellness ? [...wellness].sort((a, b) => b.id.localeCompare(a.id)) : [];
  const latest = sorted[0];

  const fitness = Math.round(latest?.ctl ?? latest?.ctlLoad ?? 0);
  const fatigue = Math.round(latest?.atl ?? latest?.atlLoad ?? 0);
  const form = fitness - fatigue;
  const hrv = latest?.hrv ?? null;
  const rhr = latest?.restingHR ?? null;
  const weight = latest?.weight ?? null;

  const on = (lookbackDays: number, field: (row: WellnessData) => number | null | undefined) =>
    latest ? baselineOnOrBefore(sorted, latest.id, lookbackDays, field) : undefined;

  const loadBaseline = on(1, trainingLoad);
  const prevFitness = loadBaseline ? Math.round(trainingLoad(loadBaseline) ?? fitness) : null;
  const prevFatigue = loadBaseline
    ? Math.round(loadBaseline.atl ?? loadBaseline.atlLoad ?? fatigue)
    : null;

  return {
    fitness,
    fitnessTrend: trend(fitness, prevFitness, 'fitness'),
    form,
    formTrend:
      prevFitness === null || prevFatigue === null
        ? ''
        : trend(form, prevFitness - prevFatigue, 'form'),
    hrv,
    hrvTrend: trend(hrv, on(1, (row) => row.hrv)?.hrv ?? null, 'hrv'),
    rhr,
    rhrTrend: trend(rhr, on(1, (row) => row.restingHR)?.restingHR ?? null, 'rhr'),
    weight,
    weightTrend: trend(weight, on(7, (row) => row.weight)?.weight ?? null, 'weight'),
  };
}
