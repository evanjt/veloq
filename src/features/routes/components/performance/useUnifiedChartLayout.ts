import { useMemo } from 'react';
import { Dimensions, PixelRatio } from 'react-native';

import {
  detectGaps,
  buildGapCompression,
  calculateChartWidth,
  DEFAULT_COMPRESSED_GAP_DAYS,
  DEFAULT_GAP_THRESHOLD_DAYS,
  type DetectedGap,
  type GapCompressionResult,
} from '@/features/stats';
import { splitIntoLanes, type LaneData } from '@/features/routes/lib/unifiedPerformanceData';
import type { PerformanceDataPoint } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_PADDING_LEFT = 40;
const CHART_PADDING_RIGHT = 20;
const MIN_POINT_SPACING = 50;
const BASE_CHART_WIDTH = SCREEN_WIDTH - 32;
// Metal/GPU texture limit is 8192px — Skia canvas backing texture is scaled by pixelRatio.
const MAX_CHART_WIDTH = Math.floor(8192 / PixelRatio.get()) - 1;

export interface UnifiedChartLayout {
  detectedGaps: DetectedGap[];
  chartWidth: number;
  chartContentWidth: number;
  isScrollable: boolean;
  dateToX: GapCompressionResult['dateToX'];
  gaps: GapCompressionResult['gaps'];
  timeAxisLabels: GapCompressionResult['timeAxisLabels'];
  forwardLane: LaneData;
  reverseLane: LaneData;
  hasForward: boolean;
  hasReverse: boolean;
  chartPaddingLeft: number;
  chartPaddingRight: number;
  baseChartWidth: number;
}

// Pure chart geometry: gap detection, dynamic width, compressed time mapping,
// and direction lane splitting. Selection/gesture state stays in the component.
export function useUnifiedChartLayout(
  chartData: PerformanceDataPoint[],
  currentIndex: number | undefined,
  linearTimeAxis: boolean,
  expandedGaps: Set<number>
): UnifiedChartLayout {
  const detectedGaps = useMemo(() => {
    if (chartData.length < 2 || linearTimeAxis) return [];
    return detectGaps(chartData, DEFAULT_GAP_THRESHOLD_DAYS);
  }, [chartData, linearTimeAxis]);

  const chartWidth = useMemo(
    () =>
      calculateChartWidth(chartData.length, detectedGaps, expandedGaps, {
        minPointSpacing: MIN_POINT_SPACING,
        baseChartWidth: BASE_CHART_WIDTH,
        maxChartWidth: MAX_CHART_WIDTH,
        chartPaddingLeft: CHART_PADDING_LEFT,
        chartPaddingRight: CHART_PADDING_RIGHT,
        compressedGapDays: DEFAULT_COMPRESSED_GAP_DAYS,
      }),
    [chartData.length, detectedGaps, expandedGaps]
  );

  const chartContentWidth = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const isScrollable = chartWidth > BASE_CHART_WIDTH;

  const { dateToX, gaps, timeAxisLabels } = useMemo(
    () =>
      buildGapCompression(chartData, detectedGaps, expandedGaps, chartWidth, {
        baseChartWidth: BASE_CHART_WIDTH,
        chartPaddingLeft: CHART_PADDING_LEFT,
        chartPaddingRight: CHART_PADDING_RIGHT,
      }),
    [chartData, detectedGaps, expandedGaps, chartWidth]
  );

  const { forwardLane, reverseLane } = useMemo(
    () => splitIntoLanes(chartData, dateToX, currentIndex),
    [chartData, currentIndex, dateToX]
  );

  return {
    detectedGaps,
    chartWidth,
    chartContentWidth,
    isScrollable,
    dateToX,
    gaps,
    timeAxisLabels,
    forwardLane,
    reverseLane,
    hasForward: forwardLane.points.length > 0,
    hasReverse: reverseLane.points.length > 0,
    chartPaddingLeft: CHART_PADDING_LEFT,
    chartPaddingRight: CHART_PADDING_RIGHT,
    baseChartWidth: BASE_CHART_WIDTH,
  };
}
