import { ledgerDate, isRouteMatchingEnabled } from '@/features/routes';
import { experimentalOn } from '@/features/settings/light';
import {
  generateStrengthInsights,
  normaliseStrengthProgression,
  normaliseStrengthSummary,
} from '@/features/strength';
import { getEngine } from '@/shared/native/engine';
import { debug } from '@/shared/debug/debug';

import type { InsightsData } from 'veloqrs';

import type { Insight } from '../types';
import { buildInsightsParams } from './insightsParams';
import {
  computeInsightsFromData as computeFromBundle,
  consolidateInsights as consolidateWithLog,
  type InsightsComputation,
} from './insightsPipeline';

export type { InsightsComputation };

const log = debug.create('ComputeInsightsData');
const devLog = __DEV__ ? (line: string) => log.log(line) : undefined;

interface InsightsEnginePayload {
  insightsData: InsightsData;
}

type TFunc = (key: string, params?: Record<string, string | number>) => string;

export function consolidateInsights(insights: Insight[]): Insight[] {
  return consolidateWithLog(insights, devLog);
}

/**
 * Compute insights from the engine's bundle on the phone.
 *
 * Pure function - no React hooks, no context. Can be called from:
 *   - useInsights() hook (React context)
 *   - backgroundInsightTask (TaskManager context, no React)
 *
 * The efficiency trend is experimental, so it reaches the list only with the
 * experimental switch and the trend's own entry on. It is read here so every
 * caller, the widget included, takes the same gate; a headless refresh that
 * never loaded the setting reads off.
 */
export function computeInsightsFromData(
  ffiData: InsightsData | null,
  t: TFunc,
  isMetric = true
): InsightsComputation {
  return computeFromBundle(ffiData, t, isMetric, {
    routeMatchingOn: isRouteMatchingEnabled(),
    efficiencyTrendsOn: experimentalOn('efficiencyTrends'),
    ledgerDate,
    log: devLog,
    strength: {
      summary: normaliseStrengthSummary,
      progression: normaliseStrengthProgression,
      cards: generateStrengthInsights,
    },
  });
}

/**
 * Fetch FFI insights data from the engine.
 * Pure function - calls synchronous FFI, no React.
 */
export function fetchInsightsDataFromEngine(): InsightsEnginePayload | null {
  const engine = getEngine();
  if (!engine) return null;

  const params = buildInsightsParams();
  const insightsData = engine.getInsightsData(params) ?? null;
  if (!insightsData) return null;

  return { insightsData };
}
