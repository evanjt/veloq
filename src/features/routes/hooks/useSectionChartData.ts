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
import type { Activity, FrequentSection, PerformanceDataPoint, RoutePoint } from '@/types';
import type { SectionPerformanceRecord } from './useSectionPerformances';

interface SectionWithTraces {
  activityTraces?: Record<string, RoutePoint[]>;
}

interface UseSectionChartDataParams {
  section: FrequentSection | null;
  performanceRecords: SectionPerformanceRecord[] | undefined;
  sectionActivitiesUnsorted: Activity[];
  sectionWithTraces: (FrequentSection & SectionWithTraces) | null;
  /** The chart payload the screen read returned for the range and sport. */
  preComputedChart: FfiSectionChartData | null;
}

export interface UseSectionChartDataResult {
  // Lookups (still derived in TS - cheap maps)
  portionMap: Map<string, { activityId: string; direction?: string; distanceMeters?: number }>;
  performanceRecordMap: Map<string, SectionPerformanceRecord>;
  sectionActivities: Activity[];

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
  section,
  performanceRecords,
  sectionActivitiesUnsorted,
  sectionWithTraces,
  preComputedChart,
}: UseSectionChartDataParams): UseSectionChartDataResult {
  // Cheap O(n) lookup maps - keep in TS, consumed by the section detail screen.
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p: { activityId: string }) => [p.activityId, p]));
  }, [section]);

  const performanceRecordMap = useMemo(() => {
    if (!performanceRecords) return new Map<string, SectionPerformanceRecord>();
    return new Map(performanceRecords.map((r) => [r.activityId, r]));
  }, [performanceRecords]);

  const sectionActivities = useMemo(() => {
    if (sectionActivitiesUnsorted.length === 0) return [];
    return [...sectionActivitiesUnsorted].sort((a, b) => {
      const recordA = performanceRecordMap.get(a.id);
      const recordB = performanceRecordMap.get(b.id);
      const paceA = recordA?.bestPace ?? (a.moving_time > 0 ? a.distance / a.moving_time : 0);
      const paceB = recordB?.bestPace ?? (b.moving_time > 0 ? b.distance / b.moving_time : 0);
      return paceB - paceA;
    });
  }, [sectionActivitiesUnsorted, performanceRecordMap]);

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
      lapPoints: sectionWithTraces?.activityTraces?.[p.activityId],
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
  }, [rustChart, sectionWithTraces]);

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
    portionMap,
    performanceRecordMap,
    sectionActivities,
    chartData,
    minSpeed,
    maxSpeed,
    hasReverseRuns,
    bestTimeValue,
    lastActivityDate,
  };
}
