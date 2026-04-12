/**
 * Computes all chart data, bucket aggregation, ranking, and summary stats
 * for the section detail page. Extracted from section/[id].tsx.
 */

import { useMemo } from 'react';
import { type ChartSummaryStats } from '@/components/routes/performance';
import { RANGE_DAYS } from '@/constants';
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
}

export interface UseSectionChartDataResult {
  // Lookups
  portionMap: Map<string, { activityId: string; direction?: string; distanceMeters?: number }>;
  performanceRecordMap: Map<string, SectionPerformanceRecord>;
  sectionActivities: Activity[];

  // Chart data
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;

  // Stats
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
}: UseSectionChartDataParams): UseSectionChartDataResult {
  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p: { activityId: string }) => [p.activityId, p]));
  }, [section?.activityPortions]);

  // Map of performance records for fast lookup
  const performanceRecordMap = useMemo(() => {
    if (!performanceRecords) return new Map<string, SectionPerformanceRecord>();
    return new Map(performanceRecords.map((r) => [r.activityId, r]));
  }, [performanceRecords]);

  // Sort activities by pace (fastest first)
  const sectionActivities = useMemo(() => {
    if (sectionActivitiesUnsorted.length === 0) return [];

    return [...sectionActivitiesUnsorted].sort((a, b) => {
      const recordA = performanceRecordMap.get(a.id);
      const recordB = performanceRecordMap.get(b.id);

      const paceA = recordA?.bestPace ?? (a.moving_time > 0 ? a.distance / a.moving_time : 0);
      const paceB = recordB?.bestPace ?? (b.moving_time > 0 ? b.distance / b.moving_time : 0);

      return paceB - paceA; // Descending (fastest first = highest pace)
    });
  }, [sectionActivitiesUnsorted, performanceRecordMap]);

  // Prepare chart data for UnifiedPerformanceChart
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (__DEV__) {
      console.log('[SectionDetail] chartData recompute:', {
        hasSection: !!section,
        sectionActivitiesCount: sectionActivities.length,
        performanceRecordsCount: performanceRecords?.length ?? 0,
      });
    }

    if (!section)
      return {
        chartData: [] as (PerformanceDataPoint & { x: number })[],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        hasReverseRuns: false,
      };

    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    // Create a map of records by activity ID for quick lookup
    const recordMap = new Map(performanceRecords?.map((r) => [r.activityId, r]) || []);

    // Sort activities by date and filter by selected time range
    const rangeDays = RANGE_DAYS[sectionTimeRange];
    const cutoffMs = rangeDays > 0 ? Date.now() - rangeDays * 86400 * 1000 : 0;
    const sortedActivities = [...sectionActivities]
      .sort(
        (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
      )
      .filter((a) => rangeDays === 0 || new Date(a.start_date_local).getTime() >= cutoffMs);

    let hasAnyReverse = false;

    for (const activity of sortedActivities) {
      const portion = portionMap.get(activity.id);
      const tracePoints = sectionWithTraces?.activityTraces?.[activity.id];
      const record = recordMap.get(activity.id);

      const sectionDistance =
        record?.sectionDistance || portion?.distanceMeters || section.distanceMeters;

      // One data point per lap (shows every individual traversal)
      if (record && record.laps && record.laps.length > 0) {
        for (const lap of record.laps) {
          const direction = lap.direction || 'same';
          if (direction === 'reverse') hasAnyReverse = true;

          dataPoints.push({
            x: 0,
            id: lap.id,
            activityId: activity.id,
            speed: lap.pace,
            date: new Date(activity.start_date_local),
            activityName: activity.name,
            direction,
            lapPoints: tracePoints,
            sectionTime: Math.round(lap.time),
            sectionDistance: lap.distance || sectionDistance,
            lapCount: 1,
          });
        }
      } else {
        const direction = record?.direction || (portion?.direction as 'same' | 'reverse') || 'same';
        if (direction === 'reverse') hasAnyReverse = true;

        let sectionSpeed: number;
        let sectionTime: number;

        if (record) {
          sectionSpeed = record.bestPace;
          sectionTime = Math.round(record.bestTime);
        } else {
          sectionSpeed = activity.moving_time > 0 ? activity.distance / activity.moving_time : 0;
          sectionTime =
            activity.distance > 0
              ? Math.round(activity.moving_time * (sectionDistance / activity.distance))
              : 0;
        }

        dataPoints.push({
          x: 0,
          id: activity.id,
          activityId: activity.id,
          speed: sectionSpeed,
          date: new Date(activity.start_date_local),
          activityName: activity.name,
          direction,
          lapPoints: tracePoints,
          sectionTime,
          sectionDistance,
          lapCount: 1,
        });
      }
    }

    // Filter out invalid speed values (NaN would crash SVG renderer)
    const validDataPoints = dataPoints.filter((d) => Number.isFinite(d.speed));
    const indexed = validDataPoints.map((d, idx) => ({ ...d, x: idx }));

    const speeds = indexed.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

    let bestIdx = 0;
    for (let i = 1; i < indexed.length; i++) {
      if (indexed[i].speed > indexed[bestIdx].speed) {
        bestIdx = i;
      }
    }

    return {
      chartData: indexed,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [
    section,
    sectionWithTraces,
    sectionActivities,
    performanceRecords,
    portionMap,
    sectionTimeRange,
  ]);

  // Compute performance rankings by speed
  const { rankMap, bestActivityId, bestTimeValue, bestPaceValue, averageTime, lastActivityDate } =
    useMemo(() => {
      if (__DEV__) {
        console.log('[SectionDetail] stats recompute:', {
          chartDataLength: chartData.length,
          firstEntry: chartData[0]
            ? { time: chartData[0].sectionTime, speed: chartData[0].speed }
            : null,
        });
      }

      if (chartData.length === 0) {
        return {
          rankMap: new Map<string, number>(),
          bestActivityId: null as string | null,
          bestTimeValue: undefined as number | undefined,
          bestPaceValue: undefined as number | undefined,
          averageTime: undefined as number | undefined,
          lastActivityDate: undefined as string | undefined,
        };
      }

      // Sort by speed descending (fastest first)
      const sorted = [...chartData].sort((a, b) => b.speed - a.speed);
      const map = new Map<string, number>();
      sorted.forEach((item, idx) => {
        // Keep best (first) rank per activity when multiple laps exist
        if (!map.has(item.activityId)) {
          map.set(item.activityId, idx + 1);
        }
      });

      const bestId = sorted.length > 0 ? sorted[0].activityId : null;
      const bestTime = sorted.length > 0 ? sorted[0].sectionTime : undefined;
      const bestPace = sorted.length > 0 ? sorted[0].speed : undefined;

      const times = chartData
        .map((d) => d.sectionTime)
        .filter((t): t is number => t !== undefined && t > 0);
      const avgTime =
        times.length > 0 ? times.reduce((sum, t) => sum + t, 0) / times.length : undefined;

      const dates = chartData.map((d) => d.date.getTime());
      const lastDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : undefined;

      return {
        rankMap: map,
        bestActivityId: bestId,
        bestTimeValue: bestTime,
        bestPaceValue: bestPace,
        averageTime: avgTime,
        lastActivityDate: lastDate,
      };
    }, [chartData]);

  // Summary stats for the chart header
  const summaryStats = useMemo((): ChartSummaryStats => {
    return {
      bestTime: bestTimeValue ?? null,
      avgTime: averageTime ?? null,
      totalActivities: chartData.length,
      lastActivity: lastActivityDate ? new Date(lastActivityDate) : null,
    };
  }, [bestTimeValue, averageTime, chartData.length, lastActivityDate]);

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
