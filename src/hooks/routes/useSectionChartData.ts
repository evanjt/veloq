/**
 * Section-detail chart data hook.
 *
 * Thin pass-through to the Rust atomic `getSectionChartData`, which emits
 * per-lap chart points + speed ranks + best/avg/last stats in one FFI
 * round-trip. Conversion here is strictly shape-matching (Rust types →
 * UI types) and null-safe defaulting — no aggregation.
 */

import { useMemo } from 'react';
import { type ChartSummaryStats } from '@/components/routes/performance';
import { RANGE_DAYS } from '@/constants';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { fromUnixSeconds, castDirection } from '@/lib/utils/ffiConversions';
import type { Activity, FrequentSection, PerformanceDataPoint, RoutePoint } from '@/types';
import type { SectionPerformanceRecord } from './useSectionPerformances';
import type { SectionTimeRange } from '@/constants';

interface SectionWithTraces {
  activityTraces?: Record<string, RoutePoint[]>;
}

interface UseSectionChartDataParams {
  section: FrequentSection | null;
  performanceRecords: SectionPerformanceRecord[] | undefined;
  sectionActivitiesUnsorted: Activity[];
  sectionWithTraces: (FrequentSection & SectionWithTraces) | null;
  sectionTimeRange: SectionTimeRange;
  /** Optional sport filter for cross-sport sections. */
  sportFilter?: string;
}

export interface UseSectionChartDataResult {
  // Lookups (still derived in TS — cheap maps)
  portionMap: Map<string, { activityId: string; direction?: string; distanceMeters?: number }>;
  performanceRecordMap: Map<string, SectionPerformanceRecord>;
  sectionActivities: Activity[];

  // Chart data (from Rust)
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;

  // Stats (from Rust)
  summaryStats: ChartSummaryStats;
  rankMap: Map<string, number>;
  bestActivityId: string | null;
  bestTimeValue: number | undefined;
  bestPaceValue: number | undefined;
  averageTime: number | undefined;
  lastActivityDate: string | undefined;
}

export function useSectionChartData({
  section,
  performanceRecords,
  sectionActivitiesUnsorted,
  sectionWithTraces,
  sectionTimeRange,
  sportFilter,
}: UseSectionChartDataParams): UseSectionChartDataResult {
  // Cheap O(n) lookup maps — keep in TS, consumed by the section detail screen.
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p: { activityId: string }) => [p.activityId, p]));
  }, [section?.activityPortions]);

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

  const rustChart = useMemo(() => {
    if (!section) return null;
    const engine = getRouteEngine();
    if (!engine) return null;
    try {
      const rangeDays = RANGE_DAYS[sectionTimeRange];
      return engine.getSectionChartData(section.id, rangeDays, sportFilter);
    } catch {
      return null;
    }
  }, [section, sectionTimeRange, sportFilter, performanceRecords]);

  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (!rustChart) {
      return {
        chartData: [] as (PerformanceDataPoint & { x: number })[],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        hasReverseRuns: false,
      };
    }

    const padding = (rustChart.maxSpeed - rustChart.minSpeed) * 0.15 || 0.5;
    const chartData: (PerformanceDataPoint & { x: number })[] = rustChart.points.map((p, idx) => ({
      x: idx,
      id: p.lapId,
      activityId: p.activityId,
      speed: p.speed,
      date: fromUnixSeconds(p.activityDate) ?? new Date(),
      activityName: p.activityName,
      direction: castDirection(p.direction),
      lapPoints: sectionWithTraces?.activityTraces?.[p.activityId],
      sectionTime: p.sectionTime,
      sectionDistance: p.sectionDistance,
      lapCount: 1,
    }));

    return {
      chartData,
      minSpeed: Math.max(0, rustChart.minSpeed - padding),
      maxSpeed: rustChart.maxSpeed + padding,
      bestIndex: rustChart.bestIndex,
      hasReverseRuns: rustChart.hasReverseRuns,
    };
  }, [rustChart, sectionWithTraces]);

  const { rankMap, bestActivityId, bestTimeValue, bestPaceValue, averageTime, lastActivityDate } =
    useMemo(() => {
      if (!rustChart) {
        return {
          rankMap: new Map<string, number>(),
          bestActivityId: null as string | null,
          bestTimeValue: undefined as number | undefined,
          bestPaceValue: undefined as number | undefined,
          averageTime: undefined as number | undefined,
          lastActivityDate: undefined as string | undefined,
        };
      }
      const rankMap = new Map<string, number>();
      for (const p of rustChart.points) {
        if (!rankMap.has(p.activityId)) rankMap.set(p.activityId, p.rank);
      }
      return {
        rankMap,
        bestActivityId: rustChart.bestActivityId ?? null,
        bestTimeValue: rustChart.bestTimeSecs,
        bestPaceValue: rustChart.bestPace,
        averageTime: rustChart.averageTimeSecs,
        lastActivityDate:
          rustChart.lastActivityDate != null
            ? (fromUnixSeconds(rustChart.lastActivityDate)?.toISOString() ?? undefined)
            : undefined,
      };
    }, [rustChart]);

  const summaryStats = useMemo((): ChartSummaryStats => {
    return {
      bestTime: bestTimeValue ?? null,
      avgTime: averageTime ?? null,
      totalActivities: rustChart?.totalActivities ?? chartData.length,
      lastActivity: lastActivityDate ? new Date(lastActivityDate) : null,
    };
  }, [bestTimeValue, averageTime, chartData.length, lastActivityDate, rustChart]);

  return {
    portionMap,
    performanceRecordMap,
    sectionActivities,
    chartData,
    minSpeed,
    maxSpeed,
    bestIndex,
    hasReverseRuns,
    summaryStats,
    rankMap,
    bestActivityId,
    bestTimeValue,
    bestPaceValue,
    averageTime,
    lastActivityDate,
  };
}
