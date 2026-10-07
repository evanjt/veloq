/**
 * Section-detail chart data hook.
 *
 * Thin pass-through to the chart payload of the section performance screen
 * read, which carries per-lap chart points + speed ranks + best/avg/last
 * stats. Conversion here is strictly shape-matching (Rust types →
 * UI types) and null-safe defaulting - no aggregation.
 */

import { useMemo } from 'react';
import { fromUnixSeconds, castDirection, ensureFinite } from '@/shared/ffi/ffiConversions';
import type { FfiSectionChartData } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

interface UseSectionChartDataParams {
  /** The chart payload the screen read returned for the range and sport. */
  preComputedChart: FfiSectionChartData | null;
}

export interface UseSectionChartDataResult {
  // Chart data (from Rust)
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  hasReverseRuns: boolean;

  // Stats (from Rust)
  bestTimeValue: number | undefined;
  lastActivityDate: string | undefined;
}

export function useSectionChartData({
  preComputedChart,
}: UseSectionChartDataParams): UseSectionChartDataResult {
  const rustChart = preComputedChart;

  const { chartData, minSpeed, maxSpeed, hasReverseRuns } = useMemo(() => {
    if (!rustChart) {
      return {
        chartData: [] as (PerformanceDataPoint & { x: number })[],
        minSpeed: 0,
        maxSpeed: 1,
        hasReverseRuns: false,
      };
    }

    // Sanitise raw Rust speeds before deriving axis bounds - a non-finite
    // min/max would poison padding and the whole y-axis range.
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
      sectionTime: ensureFinite(p.sectionTime, 0),
      sectionDistance: ensureFinite(p.sectionDistance, 0),
      lapCount: 1,
      isBest: p.isBest,
      avgPower: p.avgPower ?? undefined,
    }));

    return {
      chartData,
      minSpeed: Math.max(0, minSpeed - padding),
      maxSpeed: maxSpeed + padding,
      hasReverseRuns: rustChart.hasReverseRuns,
    };
  }, [rustChart]);

  const { bestTimeValue, lastActivityDate } = useMemo(() => {
    if (!rustChart) {
      return {
        bestTimeValue: undefined as number | undefined,
        lastActivityDate: undefined as string | undefined,
      };
    }
    // Preserve nullable semantics: a missing field stays undefined; a
    // present-but-non-finite Rust value (e.g. 0/0 pace) collapses to
    // undefined so the UI sees a clean absent stat, not 'NaN'.
    const sanitizeStat = (v: number | undefined): number | undefined =>
      v == null ? undefined : Number.isFinite(v) ? v : undefined;
    return {
      bestTimeValue: sanitizeStat(rustChart.bestTimeSecs),
      lastActivityDate:
        rustChart.lastActivityDate != null
          ? (fromUnixSeconds(rustChart.lastActivityDate)?.toISOString() ?? undefined)
          : undefined,
    };
  }, [rustChart]);

  return {
    chartData,
    minSpeed,
    maxSpeed,
    hasReverseRuns,
    bestTimeValue,
    lastActivityDate,
  };
}
