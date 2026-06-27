import { useMemo } from 'react';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import type { FrequentSection, PerformanceDataPoint } from '@/types';

interface UseSectionChartDataEnrichedArgs {
  id: string | undefined;
  section: FrequentSection | null;
  chartData: (PerformanceDataPoint & { x: number })[];
  showExcluded: boolean;
  excludedActivityIds: Set<string>;
}

export function useSectionChartDataEnriched({
  id,
  section,
  chartData,
  showExcluded,
  excludedActivityIds,
}: UseSectionChartDataEnrichedArgs) {
  // Build chart data points for excluded activities (shown dimmed on scatter chart)
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded || excludedActivityIds.size === 0 || !id) return [];
    try {
      const engine = getRouteEngine();
      if (!engine) return [];
      const result = engine.getExcludedSectionPerformances(id);
      if (!result?.records?.length) return [];

      const points: (PerformanceDataPoint & { x: number })[] = [];
      for (const r of result.records) {
        const date = fromUnixSeconds(r.activityDate);
        if (!date) continue;
        if (r.laps?.length) {
          for (const lap of r.laps) {
            if (lap.pace > 0) {
              points.push({
                x: 0,
                id: lap.id,
                activityId: r.activityId,
                speed: lap.pace,
                date,
                activityName: r.activityName,
                direction: (lap.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
                sectionTime: Math.round(lap.time),
                sectionDistance: lap.distance || r.sectionDistance,
                lapCount: 1,
                isExcluded: true,
              });
            }
          }
        } else if (r.bestPace > 0) {
          points.push({
            x: 0,
            id: r.activityId,
            activityId: r.activityId,
            speed: r.bestPace,
            date,
            activityName: r.activityName,
            direction: (r.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
            sectionTime: Math.round(r.bestTime),
            sectionDistance: r.sectionDistance,
            lapCount: 1,
            isExcluded: true,
          });
        }
      }
      return points;
    } catch (e) {
      if (__DEV__) console.warn('[SectionDetail] getExcludedSectionPerformances failed:', e);
      return [];
    }
  }, [showExcluded, excludedActivityIds, id]);

  // Calendar summary: Year > Month performance history
  const calendarSummary = useMemo(() => {
    if (!section?.id) return null;
    try {
      const engine = getRouteEngine();
      if (!engine) return null;
      const t0 = performance.now();
      const result = engine.getSectionCalendarSummary(section.id);
      if (__DEV__)
        console.log(`[PERF] getSectionCalendarSummary: ${(performance.now() - t0).toFixed(1)}ms`);
      return result ?? null;
    } catch {
      return null;
    }
  }, [section?.id]);

  // Enrich chart data with PR info for tooltip display
  const enrichedChartData = useMemo(() => {
    if (chartData.length === 0) return chartData;

    // Find best time/speed per direction from non-excluded points
    let fwdBestTime: number | undefined;
    let fwdBestSpeed: number | undefined;
    let revBestTime: number | undefined;
    let revBestSpeed: number | undefined;

    for (const p of chartData) {
      if (p.direction === 'reverse') {
        if (revBestSpeed === undefined || p.speed > revBestSpeed) {
          revBestSpeed = p.speed;
          revBestTime = p.sectionTime;
        }
      } else {
        if (fwdBestSpeed === undefined || p.speed > fwdBestSpeed) {
          fwdBestSpeed = p.speed;
          fwdBestTime = p.sectionTime;
        }
      }
    }

    return chartData.map((p) => {
      const isReverse = p.direction === 'reverse';
      const dirBestTime = isReverse ? revBestTime : fwdBestTime;
      const dirBestSpeed = isReverse ? revBestSpeed : fwdBestSpeed;
      const isBest = dirBestSpeed !== undefined && p.speed === dirBestSpeed;
      return { ...p, bestTime: dirBestTime, bestSpeed: dirBestSpeed, isBest };
    });
  }, [chartData]);

  // Merge excluded points into chart data when showing excluded
  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

  return { excludedChartData, calendarSummary, enrichedChartData, combinedChartData };
}
