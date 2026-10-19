import { useMemo } from 'react';
import {
  castDirection,
  castOffScale,
  ensureFinite,
  fromWallClockSeconds,
} from '@/shared/ffi/ffiConversions';
import type { FfiCalendarSummary, FfiSectionChartPoint } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';
import type { SectionPerformanceRecord } from './useSectionPerformances';

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
  bestForwardRecord: Pick<SectionPerformanceRecord, 'bestTime' | 'bestPace'> | null;
  bestReverseRecord: Pick<SectionPerformanceRecord, 'bestTime' | 'bestPace'> | null;
}

export function useSectionChartDataEnriched({
  chartData,
  showExcluded,
  excludedPoints,
  preComputedCalendarSummary,
  bestForwardRecord,
  bestReverseRecord,
}: UseSectionChartDataEnrichedArgs) {
  // The excluded attempts, dimmed on the scatter chart when shown.
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded) return [];
    return excludedPoints.flatMap((p) => {
      const date = fromWallClockSeconds(p.activityDate);
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
          outsideDistanceBand: p.outsideDistanceBand,
          matchPercentage: p.matchPercentage ?? undefined,
          offScale: castOffScale(p.offScale),
        },
      ];
    });
  }, [showExcluded, excludedPoints]);

  const calendarSummary = preComputedCalendarSummary;

  const enrichedChartData = useMemo(() => {
    return chartData.map((p) => {
      const best = p.direction === 'reverse' ? bestReverseRecord : bestForwardRecord;
      return { ...p, bestTime: best?.bestTime, bestSpeed: best?.bestPace };
    });
  }, [chartData, bestForwardRecord, bestReverseRecord]);

  // Merge excluded points into chart data when showing excluded
  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

  return { excludedChartData, calendarSummary, enrichedChartData, combinedChartData };
}
