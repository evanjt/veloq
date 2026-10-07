import { useMemo } from 'react';
import { castDirection, ensureFinite, fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import type { FfiCalendarSummary, FfiSectionChartPoint } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

interface UseSectionChartDataEnrichedArgs {
  chartData: (PerformanceDataPoint & { x: number })[];
  showExcluded: boolean;
  /**
   * The excluded attempts the screen read returned, for the same range and
   * sport as `chartData`, so the dimmed points never stretch the axis or
   * cross the sport filter.
   */
  excludedPoints: readonly FfiSectionChartPoint[];
  /** The calendar summary the screen read returned for the same range and sport. */
  preComputedCalendarSummary: FfiCalendarSummary | null;
}

export function useSectionChartDataEnriched({
  chartData,
  showExcluded,
  excludedPoints,
  preComputedCalendarSummary,
}: UseSectionChartDataEnrichedArgs) {
  // The excluded attempts, dimmed on the scatter chart when shown.
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded) return [];
    return excludedPoints.flatMap((p) => {
      const date = fromUnixSeconds(p.activityDate);
      if (!date || !(p.speed > 0)) return [];
      return [
        {
          x: 0,
          id: p.lapId,
          activityId: p.activityId,
          speed: ensureFinite(p.speed, 0),
          date,
          activityName: p.activityName,
          direction: castDirection(p.direction),
          sectionTime: ensureFinite(p.sectionTime, 0),
          sectionDistance: ensureFinite(p.sectionDistance, 0),
          lapCount: 1,
          isExcluded: true,
          avgPower: p.avgPower ?? undefined,
        },
      ];
    });
  }, [showExcluded, excludedPoints]);

  const calendarSummary = preComputedCalendarSummary;

  // Enrich chart data with the best to compare each point against; the
  // record flag itself is the engine's, carried on the point
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
      return { ...p, bestTime: dirBestTime, bestSpeed: dirBestSpeed };
    });
  }, [chartData]);

  // Merge excluded points into chart data when showing excluded
  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

  return { excludedChartData, calendarSummary, enrichedChartData, combinedChartData };
}
