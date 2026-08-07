/**
 * Shaping for the section-detail chart.
 *
 * The Rust engine answers `getSectionChartData` in one round trip. Everything
 * here turns that answer into UI types: no aggregation, no engine access, no
 * React, so it can be tested on its own.
 */

import { fromUnixSeconds, castDirection, ensureFinite } from '@/shared/ffi/ffiConversions';
import type { PerformanceDataPoint, RoutePoint } from '@/types';

/**
 * The engine answer, described structurally rather than imported, so this
 * layer stays free of the native module and its generated types.
 */
export interface SectionChartSource {
  points: Array<{
    lapId: string;
    activityId: string;
    activityName: string;
    activityDate: number;
    direction: string;
    speed: number;
    sectionTime: number;
    sectionDistance: number;
    rank: number;
  }>;
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
  bestActivityId?: string;
  bestTimeSecs?: number;
  bestPace?: number;
  averageTimeSecs?: number;
  lastActivityDate?: number;
  totalActivities: number;
}

export interface SectionChartShape {
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
}

export interface SectionChartStats {
  rankMap: Map<string, number>;
  bestActivityId: string | null;
  bestTimeValue: number | undefined;
  bestPaceValue: number | undefined;
  averageTime: number | undefined;
  lastActivityDate: string | undefined;
}

const EMPTY_SHAPE: SectionChartShape = {
  chartData: [],
  minSpeed: 0,
  maxSpeed: 1,
  bestIndex: 0,
  hasReverseRuns: false,
};

/**
 * A missing field stays undefined. A present but non-finite value, say a 0/0
 * pace, also collapses to undefined so the UI shows an absent stat rather
 * than 'NaN'.
 */
function sanitiseStat(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Number.isFinite(value) ? value : undefined;
}

export function buildSectionChartShape(
  rustChart: SectionChartSource | null,
  activityTraces: Record<string, RoutePoint[]> | undefined
): SectionChartShape {
  if (!rustChart) return EMPTY_SHAPE;

  // Sanitise the raw speeds before deriving axis bounds. A non-finite min or
  // max would poison the padding and take the whole y-axis range with it.
  const minSpeed = ensureFinite(rustChart.minSpeed, 0);
  const maxSpeed = ensureFinite(rustChart.maxSpeed, 1);
  const padding = (maxSpeed - minSpeed) * 0.15 || 0.5;

  const chartData: (PerformanceDataPoint & { x: number })[] = rustChart.points.map((p, idx) => ({
    x: idx,
    id: p.lapId,
    activityId: p.activityId,
    speed: ensureFinite(p.speed, 0),
    date: fromUnixSeconds(p.activityDate) ?? new Date(),
    activityName: p.activityName,
    direction: castDirection(p.direction),
    lapPoints: activityTraces?.[p.activityId],
    sectionTime: ensureFinite(p.sectionTime, 0),
    sectionDistance: ensureFinite(p.sectionDistance, 0),
    lapCount: 1,
  }));

  return {
    chartData,
    minSpeed: Math.max(0, minSpeed - padding),
    maxSpeed: maxSpeed + padding,
    bestIndex: rustChart.bestIndex,
    hasReverseRuns: rustChart.hasReverseRuns,
  };
}

export function buildSectionChartStats(rustChart: SectionChartSource | null): SectionChartStats {
  if (!rustChart) {
    return {
      rankMap: new Map(),
      bestActivityId: null,
      bestTimeValue: undefined,
      bestPaceValue: undefined,
      averageTime: undefined,
      lastActivityDate: undefined,
    };
  }

  const rankMap = new Map<string, number>();
  for (const p of rustChart.points) {
    if (!rankMap.has(p.activityId)) rankMap.set(p.activityId, p.rank);
  }

  return {
    rankMap,
    bestActivityId: rustChart.bestActivityId ?? null,
    bestTimeValue: sanitiseStat(rustChart.bestTimeSecs),
    bestPaceValue: sanitiseStat(rustChart.bestPace),
    averageTime: sanitiseStat(rustChart.averageTimeSecs),
    lastActivityDate:
      rustChart.lastActivityDate != null
        ? (fromUnixSeconds(rustChart.lastActivityDate)?.toISOString() ?? undefined)
        : undefined,
  };
}
