/**
 * Computes all chart data, bucket aggregation, ranking, and summary stats
 * for the section detail page. Extracted from section/[id].tsx.
 */

import { useMemo } from 'react';
import { fromUnixSeconds } from '@/lib/utils/ffiConversions';
import {
  type ChartSummaryStats,
  type DirectionSummaryStats,
} from '@/components/routes/performance';
import { RANGE_DAYS, BUCKET_THRESHOLD } from '@/constants';
import type { Activity, FrequentSection, PerformanceDataPoint, RoutePoint } from '@/types';
import type { ActivitySectionRecord } from './useSectionPerformances';
import type { SectionTimeRange, BucketType } from '@/constants';

interface SectionWithTraces {
  activityTraces?: Record<string, RoutePoint[]>;
}

interface UseSectionChartDataParams {
  section: FrequentSection | null;
  performanceRecords: ActivitySectionRecord[] | undefined;
  sectionActivitiesUnsorted: Activity[];
  sectionWithTraces: (FrequentSection & SectionWithTraces) | null;
  sectionTimeRange: SectionTimeRange;
  bucketType: BucketType;
}

interface BucketEntry {
  activityId: string;
  activityName: string;
  activityDate: number;
  bestTime: number;
  bestPace: number;
  direction: string;
  sectionDistance: number;
  isEstimated: boolean;
  bucketCount: number;
}

interface BucketResult {
  buckets: BucketEntry[];
  totalTraversals: number;
  prBucket: BucketEntry | null;
  forwardStats: { avgTime: number; lastActivity: number; count: number } | null;
  reverseStats: { avgTime: number; lastActivity: number; count: number } | null;
}

interface DirectionBestRecord {
  bestTime: number;
  bestPace: number;
  activityName: string;
  activityDate: Date;
}

export interface UseSectionChartDataResult {
  // Lookups
  portionMap: Map<string, { activityId: string; direction?: string; distanceMeters?: number }>;
  performanceRecordMap: Map<string, ActivitySectionRecord>;
  sectionActivities: Activity[];

  // Individual chart data
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;

  // Bucket chart data
  useBucketedChart: boolean;
  bucketResult: BucketResult | null;
  bucketChartData: (PerformanceDataPoint & { x: number })[];
  bucketMinSpeed: number;
  bucketMaxSpeed: number;
  bucketBestIndex: number;
  bucketHasReverseRuns: boolean;
  bucketSummaryStats: ChartSummaryStats | null;
  bucketForwardStats: DirectionSummaryStats | null;
  bucketReverseStats: DirectionSummaryStats | null;
  bucketBestForward: DirectionBestRecord | null;
  bucketBestReverse: DirectionBestRecord | null;

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
  bucketType,
}: UseSectionChartDataParams): UseSectionChartDataResult {
  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p: { activityId: string }) => [p.activityId, p]));
  }, [section?.activityPortions]);

  // Determine if this section has enough traversals to use bucketed chart
  const activityCount = section?.activityIds?.length ?? 0;
  const useBucketedChart = activityCount >= BUCKET_THRESHOLD;

  // Client-side bucketing function
  const bucketResult = useMemo((): BucketResult | null => {
    if (!useBucketedChart || !performanceRecords || performanceRecords.length === 0) return null;

    const t0 = performance.now();
    const rangeDays = RANGE_DAYS[sectionTimeRange];
    const now = Date.now() / 1000; // Unix timestamp in seconds
    const cutoff = rangeDays === 0 ? 0 : now - rangeDays * 86400;

    interface DirPerf {
      activityId: string;
      activityName: string;
      activityDate: number; // Unix timestamp
      bestTime: number;
      bestPace: number;
      isReverse: boolean;
      sectionDistance: number;
    }

    // Flatten records into per-activity, per-direction best laps
    const allPerfs: DirPerf[] = [];
    for (const record of performanceRecords) {
      let fwdBestTime = Infinity;
      let fwdBestPace = 0;
      let revBestTime = Infinity;
      let revBestPace = 0;
      let hasFwd = false;
      let hasRev = false;

      for (const lap of record.laps) {
        if (lap.direction === 'reverse') {
          hasRev = true;
          if (lap.time < revBestTime) {
            revBestTime = lap.time;
            revBestPace = lap.pace;
          }
        } else {
          hasFwd = true;
          if (lap.time < fwdBestTime) {
            fwdBestTime = lap.time;
            fwdBestPace = lap.pace;
          }
        }
      }

      const activityDate = Math.floor(record.activityDate.getTime() / 1000);

      if (hasFwd) {
        allPerfs.push({
          activityId: record.activityId,
          activityName: record.activityName,
          activityDate,
          bestTime: fwdBestTime,
          bestPace: fwdBestPace,
          isReverse: false,
          sectionDistance: record.sectionDistance,
        });
      }
      if (hasRev) {
        allPerfs.push({
          activityId: record.activityId,
          activityName: record.activityName,
          activityDate,
          bestTime: revBestTime,
          bestPace: revBestPace,
          isReverse: true,
          sectionDistance: record.sectionDistance,
        });
      }
    }

    // Filter by date range
    const inRange = allPerfs.filter((p) => p.activityDate >= cutoff);

    // Find overall PR (fastest across ALL time)
    const overallPr = allPerfs.reduce(
      (best, p) => (!best || p.bestTime < best.bestTime ? p : best),
      null as DirPerf | null
    );

    // Calendar bucketing helper
    const getCalendarBucket = (timestamp: number): number => {
      const date = new Date(timestamp * 1000);
      if (bucketType === 'weekly') {
        // Week number: days since epoch / 7
        return Math.floor(timestamp / (86400 * 7));
      } else if (bucketType === 'monthly') {
        return date.getFullYear() * 12 + date.getMonth();
      } else if (bucketType === 'quarterly') {
        return date.getFullYear() * 4 + Math.floor(date.getMonth() / 3);
      } else {
        // yearly
        return date.getFullYear();
      }
    };

    // Group into buckets, keeping best per bucket per direction
    const bucketMap = new Map<string, { perf: DirPerf; count: number }>();
    for (const perf of inRange) {
      const bucketKey = getCalendarBucket(perf.activityDate);
      const dirKey = perf.isReverse ? 'reverse' : 'same';
      const key = `${bucketKey}_${dirKey}`;

      const existing = bucketMap.get(key);
      if (!existing || perf.bestTime < existing.perf.bestTime) {
        bucketMap.set(key, {
          perf: { ...perf },
          count: existing ? existing.count + 1 : 1,
        });
      } else {
        bucketMap.set(key, {
          ...existing,
          count: existing.count + 1,
        });
      }
    }

    // Convert to sorted array
    const buckets = Array.from(bucketMap.values())
      .map(({ perf, count }) => ({
        activityId: perf.activityId,
        activityName: perf.activityName,
        activityDate: perf.activityDate,
        bestTime: perf.bestTime,
        bestPace: perf.bestPace,
        direction: perf.isReverse ? 'reverse' : 'same',
        sectionDistance: perf.sectionDistance,
        isEstimated: false,
        bucketCount: count,
      }))
      .sort((a, b) => a.activityDate - b.activityDate);

    // Direction stats
    const fwdInRange = inRange.filter((p) => !p.isReverse);
    const revInRange = inRange.filter((p) => p.isReverse);

    const fwdStats =
      fwdInRange.length > 0
        ? {
            avgTime: fwdInRange.reduce((sum, p) => sum + p.bestTime, 0) / fwdInRange.length,
            lastActivity: Math.max(...fwdInRange.map((p) => p.activityDate)),
            count: fwdInRange.length,
          }
        : null;

    const revStats =
      revInRange.length > 0
        ? {
            avgTime: revInRange.reduce((sum, p) => sum + p.bestTime, 0) / revInRange.length,
            lastActivity: Math.max(...revInRange.map((p) => p.activityDate)),
            count: revInRange.length,
          }
        : null;

    if (__DEV__)
      console.log(`[PERF] client-side bucketing: ${(performance.now() - t0).toFixed(1)}ms`);

    return {
      buckets,
      totalTraversals: inRange.length,
      prBucket: overallPr
        ? {
            activityId: overallPr.activityId,
            activityName: overallPr.activityName,
            activityDate: overallPr.activityDate,
            bestTime: overallPr.bestTime,
            bestPace: overallPr.bestPace,
            direction: overallPr.isReverse ? 'reverse' : 'same',
            sectionDistance: overallPr.sectionDistance,
            isEstimated: false,
            bucketCount: 1,
          }
        : null,
      forwardStats: fwdStats,
      reverseStats: revStats,
    };
  }, [useBucketedChart, performanceRecords, sectionTimeRange, bucketType]);

  // Build chart data from buckets (for sections with many traversals)
  const { bucketChartData, bucketMinSpeed, bucketMaxSpeed, bucketBestIndex, bucketHasReverseRuns } =
    useMemo(() => {
      if (!bucketResult || bucketResult.buckets.length === 0) {
        return {
          bucketChartData: [] as (PerformanceDataPoint & { x: number })[],
          bucketMinSpeed: 0,
          bucketMaxSpeed: 1,
          bucketBestIndex: 0,
          bucketHasReverseRuns: false,
        };
      }

      let hasAnyReverse = false;
      const dataPoints = bucketResult.buckets.map((b, idx) => {
        if (b.direction === 'reverse') hasAnyReverse = true;
        return {
          x: idx,
          id: b.activityId,
          activityId: b.activityId,
          speed: b.bestPace,
          date: fromUnixSeconds(b.activityDate) ?? new Date(),
          activityName: b.activityName,
          direction: b.direction as 'same' | 'reverse',
          sectionTime: Math.round(b.bestTime),
          sectionDistance: b.sectionDistance,
          lapCount: b.bucketCount,
        };
      });

      const speeds = dataPoints.map((d) => d.speed);
      const min = Math.min(...speeds);
      const max = Math.max(...speeds);
      const padding = (max - min) * 0.15 || 0.5;

      let bestIdx = 0;
      for (let i = 1; i < dataPoints.length; i++) {
        if (dataPoints[i].speed > dataPoints[bestIdx].speed) bestIdx = i;
      }

      return {
        bucketChartData: dataPoints,
        bucketMinSpeed: Math.max(0, min - padding),
        bucketMaxSpeed: max + padding,
        bucketBestIndex: bestIdx,
        bucketHasReverseRuns: hasAnyReverse,
      };
    }, [bucketResult]);

  // Bucketed chart summary stats
  const bucketSummaryStats = useMemo((): ChartSummaryStats | null => {
    if (!bucketResult) return null;
    const pr = bucketResult.prBucket;
    const allTimes = bucketResult.buckets.map((b) => b.bestTime).filter((t) => t > 0);
    const avgTime =
      allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : null;
    const lastDate =
      bucketResult.buckets.length > 0
        ? fromUnixSeconds(bucketResult.buckets[bucketResult.buckets.length - 1].activityDate)
        : null;
    return {
      bestTime: pr?.bestTime ?? null,
      avgTime,
      totalActivities: bucketResult.totalTraversals,
      lastActivity: lastDate,
    };
  }, [bucketResult]);

  // Bucketed direction stats
  const bucketForwardStats = useMemo((): DirectionSummaryStats | null => {
    if (!bucketResult?.forwardStats) return null;
    const s = bucketResult.forwardStats;
    return {
      avgTime: s.avgTime ?? null,
      lastActivity: s.lastActivity ? fromUnixSeconds(s.lastActivity) : null,
      count: s.count,
    };
  }, [bucketResult?.forwardStats]);

  const bucketReverseStats = useMemo((): DirectionSummaryStats | null => {
    if (!bucketResult?.reverseStats) return null;
    const s = bucketResult.reverseStats;
    return {
      avgTime: s.avgTime ?? null,
      lastActivity: s.lastActivity ? fromUnixSeconds(s.lastActivity) : null,
      count: s.count,
    };
  }, [bucketResult?.reverseStats]);

  // Best records per direction from bucket data
  const { bucketBestForward, bucketBestReverse } = useMemo(() => {
    if (!bucketResult?.buckets)
      return {
        bucketBestForward: null as DirectionBestRecord | null,
        bucketBestReverse: null as DirectionBestRecord | null,
      };
    let bestFwd: BucketEntry | null = null;
    let bestRev: BucketEntry | null = null;
    for (const b of bucketResult.buckets) {
      if (b.bestTime <= 0) continue;
      if (b.direction === 'same' || b.direction === 'forward') {
        if (!bestFwd || b.bestPace > bestFwd.bestPace) bestFwd = b;
      } else if (b.direction === 'reverse' || b.direction === 'backward') {
        if (!bestRev || b.bestPace > bestRev.bestPace) bestRev = b;
      }
    }
    const toRecord = (b: BucketEntry): DirectionBestRecord | null => {
      const date = fromUnixSeconds(b.activityDate);
      if (!date) return null;
      return {
        bestTime: b.bestTime,
        bestPace: b.bestPace,
        activityName: b.activityName,
        activityDate: date,
      };
    };
    return {
      bucketBestForward: bestFwd ? toRecord(bestFwd) : null,
      bucketBestReverse: bestRev ? toRecord(bestRev) : null,
    };
  }, [bucketResult?.buckets]);

  // Map of performance records for fast lookup
  const performanceRecordMap = useMemo(() => {
    if (!performanceRecords) return new Map<string, ActivitySectionRecord>();
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

    // Sort activities by date
    const sortedActivities = [...sectionActivities].sort(
      (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
    );

    let hasAnyReverse = false;

    for (const activity of sortedActivities) {
      const portion = portionMap.get(activity.id);
      const tracePoints = sectionWithTraces?.activityTraces?.[activity.id];
      const record = recordMap.get(activity.id);

      const sectionDistance =
        record?.sectionDistance || portion?.distanceMeters || section.distanceMeters;

      // Use fastest lap only (one entry per activity)
      if (record && record.laps && record.laps.length > 0) {
        const fastestLap = record.laps.reduce((best, lap) => (lap.pace > best.pace ? lap : best));
        const direction = fastestLap.direction || 'same';
        if (direction === 'reverse') hasAnyReverse = true;

        dataPoints.push({
          x: 0,
          id: activity.id,
          activityId: activity.id,
          speed: fastestLap.pace,
          date: new Date(activity.start_date_local),
          activityName: activity.name,
          direction,
          lapPoints: tracePoints,
          sectionTime: Math.round(fastestLap.time),
          sectionDistance,
          lapCount: record.laps.length,
        });
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
  }, [section, sectionWithTraces, sectionActivities, performanceRecords, portionMap]);

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
        map.set(item.activityId, idx + 1);
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
    useBucketedChart,
    bucketResult,
    bucketChartData,
    bucketMinSpeed,
    bucketMaxSpeed,
    bucketBestIndex,
    bucketHasReverseRuns,
    bucketSummaryStats,
    bucketForwardStats,
    bucketReverseStats,
    bucketBestForward,
    bucketBestReverse,
    summaryStats,
    rankMap,
    bestActivityId,
    bestTimeValue,
    bestPaceValue,
    averageTime,
    lastActivityDate,
  };
}
