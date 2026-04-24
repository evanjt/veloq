/**
 * Pure gap-compression math for performance charts.
 *
 * When performance data spans a large time range with long idle periods
 * between efforts, a simple linear time axis wastes horizontal space. This
 * module detects gaps longer than a threshold and compresses them to a
 * fixed visual width, then builds a dateToX mapping, gap position data,
 * and time-axis labels.
 *
 * The functions here are pure (no React, no Victory) so they can be unit
 * tested in isolation. The UnifiedPerformanceChart component is responsible
 * for driving these with sorted chartData and user-expansion state.
 */

import { safeGetTime } from '@/lib';

/** A gap in the data between two adjacent sorted points. */
export interface DetectedGap {
  /** Index (in sorted order) of the point before the gap. */
  beforeIdx: number;
  /** Index (in sorted order) of the point after the gap. */
  afterIdx: number;
  /** Length of the gap in calendar days (rounded). */
  gapDays: number;
  /** Date of the point before the gap. */
  startDate: Date;
  /** Date of the point after the gap. */
  endDate: Date;
}

/** Position info for a detected gap in the compressed coordinate space. */
export interface GapWithPosition {
  /** Normalized X center (0..1) of the gap indicator. */
  xPosition: number;
  /** Normalized X of the left edge (position of startDate). */
  startX: number;
  /** Normalized X of the right edge (position of endDate). */
  endX: number;
  /** Length of the gap in calendar days (rounded). */
  gapDays: number;
  /** Index of this gap within the detected-gaps array. */
  gapIndex: number;
  /** Whether the user has expanded this gap to its full width. */
  isExpanded: boolean;
}

/** A label on the time axis. */
export interface TimeAxisLabel {
  /** The calendar date this label represents. */
  date: Date;
  /** Normalized X position (0..1) on the compressed axis. */
  position: number;
}

/** Configuration for gap-compression behaviour. */
export interface GapCompressionConfig {
  /** Gaps shorter than this (in days) are not compressed. Default: 14. */
  gapThresholdDays?: number;
  /** Visual width (in days) of each compressed gap. Default: 5. */
  compressedGapDays?: number;
}

/** Result of building a compressed time mapping from sorted data. */
export interface GapCompressionResult {
  /** Function that maps a Date to a normalized X position (0..1). */
  dateToX: (date: Date) => number;
  /** Positions of all detected gaps in the compressed space. */
  gaps: GapWithPosition[];
  /** Time-axis labels for data points, gap boundaries, and monthly markers. */
  timeAxisLabels: TimeAxisLabel[];
}

export const DEFAULT_GAP_THRESHOLD_DAYS = 14;
export const DEFAULT_COMPRESSED_GAP_DAYS = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Detect gaps between adjacent points in `dates` that exceed the threshold.
 * Input dates do not need to be sorted; they are sorted internally.
 *
 * @param dates Points with a `date` field.
 * @param gapThresholdDays Gaps shorter than this return nothing.
 * @returns Detected gaps in sorted order.
 */
export function detectGaps<T extends { date: Date }>(
  dates: T[],
  gapThresholdDays: number = DEFAULT_GAP_THRESHOLD_DAYS
): DetectedGap[] {
  if (dates.length < 2) return [];

  const sortedDates = [...dates].sort((a, b) => safeGetTime(a.date) - safeGetTime(b.date));
  const gapThresholdMs = gapThresholdDays * MS_PER_DAY;

  const gaps: DetectedGap[] = [];

  for (let i = 1; i < sortedDates.length; i++) {
    const prevTime = sortedDates[i - 1].date.getTime();
    const currTime = sortedDates[i].date.getTime();
    const gapMs = currTime - prevTime;

    if (gapMs > gapThresholdMs) {
      gaps.push({
        beforeIdx: i - 1,
        afterIdx: i,
        gapDays: Math.round(gapMs / MS_PER_DAY),
        startDate: sortedDates[i - 1].date,
        endDate: sortedDates[i].date,
      });
    }
  }

  return gaps;
}

/**
 * Build a linear (non-compressed) date->X mapping and month-based labels.
 * Used when the caller opts out of gap compression (`linearTimeAxis=true`)
 * or when no gaps exceed the threshold.
 */
function buildLinearMapping<T extends { date: Date }>(
  sortedDates: T[],
  baseChartWidth: number,
  chartPaddingLeft: number,
  chartPaddingRight: number
): GapCompressionResult {
  const firstTime = sortedDates[0].date.getTime();
  const lastTime = sortedDates[sortedDates.length - 1].date.getTime();
  const totalRange = lastTime - firstTime || 1;

  const convertDateToX = (date: Date): number => {
    const t = date.getTime();
    return 0.05 + ((t - firstTime) / totalRange) * 0.9;
  };

  const labels: TimeAxisLabel[] = [];
  const firstDate = sortedDates[0].date;
  const lastDate = sortedDates[sortedDates.length - 1].date;
  const monthsInRange =
    (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
    (lastDate.getMonth() - firstDate.getMonth());
  // Step: quarterly for >18 months, bimonthly for >6 months, monthly otherwise
  const monthStep = monthsInRange > 18 ? 3 : monthsInRange > 6 ? 2 : 1;

  const currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  while (currentMonth <= lastDate) {
    if (currentMonth >= firstDate || currentMonth.getMonth() === firstDate.getMonth()) {
      labels.push({
        date: new Date(currentMonth),
        position: convertDateToX(currentMonth),
      });
    }
    currentMonth.setMonth(currentMonth.getMonth() + monthStep);
  }

  // Filter out labels that are too close together (~70px minimum spacing)
  const chartContentW = baseChartWidth - chartPaddingLeft - chartPaddingRight;
  const minSpacing = 70 / chartContentW;
  const uniqueLabels = labels
    .sort((a, b) => a.position - b.position)
    .filter(
      (label, idx, arr) =>
        idx === 0 || Math.abs(label.position - arr[idx - 1].position) >= minSpacing
    );

  return {
    dateToX: convertDateToX,
    gaps: [],
    timeAxisLabels: uniqueLabels,
  };
}

/**
 * Build a compressed-time date->X mapping, gap positions, and axis labels.
 *
 * Strategy:
 *   1. Walk `sortedDates` accumulating "compressed time" where each gap
 *      longer than the threshold contributes either its full length (if
 *      the user expanded it) or `compressedGapDays` (default 5).
 *   2. Produce a `dateToX` that interpolates inside that mapping.
 *   3. Label data points, gap boundaries, and monthly tick marks,
 *      deduplicating collisions.
 *
 * @param chartData Sorted or unsorted chart points with `date` fields.
 * @param detectedGaps Output of {@link detectGaps}; pass `[]` for a linear axis.
 * @param expandedGaps Indices of gaps the user has expanded (by index in detectedGaps).
 * @param chartWidth Pixel width of the current chart (used for label spacing).
 * @param options Layout constants and behaviour overrides.
 */
export function buildGapCompression<T extends { date: Date }>(
  chartData: T[],
  detectedGaps: DetectedGap[],
  expandedGaps: Set<number>,
  chartWidth: number,
  options: {
    baseChartWidth: number;
    chartPaddingLeft: number;
    chartPaddingRight: number;
    gapThresholdDays?: number;
    compressedGapDays?: number;
  }
): GapCompressionResult {
  const {
    baseChartWidth,
    chartPaddingLeft,
    chartPaddingRight,
    gapThresholdDays = DEFAULT_GAP_THRESHOLD_DAYS,
    compressedGapDays = DEFAULT_COMPRESSED_GAP_DAYS,
  } = options;

  if (chartData.length === 0) {
    return {
      dateToX: () => 0.5,
      gaps: [],
      timeAxisLabels: [],
    };
  }

  const sortedDates = [...chartData].sort((a, b) => safeGetTime(a.date) - safeGetTime(b.date));

  // If no gaps detected, use linear scale
  if (detectedGaps.length === 0) {
    return buildLinearMapping(sortedDates, baseChartWidth, chartPaddingLeft, chartPaddingRight);
  }

  // Build time mapping with gap compression
  const compressedGapMs = compressedGapDays * MS_PER_DAY;
  const gapThresholdMs = gapThresholdDays * MS_PER_DAY;
  const timeMapping: { originalTime: number; compressedTime: number }[] = [];
  let compressedTime = 0;
  let gapCounter = 0;

  for (let i = 0; i < sortedDates.length; i++) {
    const currTime = sortedDates[i].date.getTime();

    if (i === 0) {
      timeMapping.push({ originalTime: currTime, compressedTime: 0 });
    } else {
      const prevTime = sortedDates[i - 1].date.getTime();
      const gapMs = currTime - prevTime;
      const isLargeGap = gapMs > gapThresholdMs;

      if (isLargeGap) {
        const userExpandedThisGap = expandedGaps.has(gapCounter);
        if (userExpandedThisGap) {
          compressedTime += gapMs;
        } else {
          compressedTime += compressedGapMs;
        }
        gapCounter++;
      } else {
        compressedTime += gapMs;
      }
      timeMapping.push({ originalTime: currTime, compressedTime });
    }
  }

  const totalCompressedRange = compressedTime || 1;

  const convertDateToX = (date: Date): number => {
    const t = date.getTime();
    for (let j = 0; j < timeMapping.length; j++) {
      if (timeMapping[j].originalTime === t) {
        return 0.05 + (timeMapping[j].compressedTime / totalCompressedRange) * 0.9;
      }
    }
    // Interpolate for times not in mapping
    for (let j = 1; j < timeMapping.length; j++) {
      if (t < timeMapping[j].originalTime) {
        const prevMap = timeMapping[j - 1];
        const nextMap = timeMapping[j];
        const ratio = (t - prevMap.originalTime) / (nextMap.originalTime - prevMap.originalTime);
        const interpCompressed =
          prevMap.compressedTime + ratio * (nextMap.compressedTime - prevMap.compressedTime);
        return 0.05 + (interpCompressed / totalCompressedRange) * 0.9;
      }
    }
    return 0.5;
  };

  // Calculate gap positions for indicators
  const gapsWithPositions: GapWithPosition[] = detectedGaps.map((gap, idx) => {
    const beforeX = convertDateToX(gap.startDate);
    const afterX = convertDateToX(gap.endDate);
    return {
      xPosition: (beforeX + afterX) / 2,
      startX: beforeX,
      endX: afterX,
      gapDays: gap.gapDays,
      gapIndex: idx,
      isExpanded: expandedGaps.has(idx),
    };
  });

  // Generate time axis labels - data points, gap boundaries, and monthly markers
  const labels: TimeAxisLabel[] = [];

  const firstDate = sortedDates[0].date;
  const lastDate = sortedDates[sortedDates.length - 1].date;

  // Add labels at actual data points (most important)
  sortedDates.forEach(({ date }) => {
    labels.push({ date, position: convertDateToX(date) });
  });

  // Add labels at gap boundaries for context
  gapsWithPositions.forEach((_, idx) => {
    const gapInfo = detectedGaps[idx];
    if (gapInfo) {
      labels.push({
        date: gapInfo.startDate,
        position: convertDateToX(gapInfo.startDate),
      });
      labels.push({
        date: gapInfo.endDate,
        position: convertDateToX(gapInfo.endDate),
      });
    }
  });

  // Add monthly markers if range > 3 months
  const monthsInRange =
    (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
    (lastDate.getMonth() - firstDate.getMonth());
  if (monthsInRange > 3) {
    const currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 1);
    while (currentMonth <= lastDate) {
      labels.push({
        date: new Date(currentMonth),
        position: convertDateToX(currentMonth),
      });
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
  }

  // Remove duplicates (by position) and sort — ~50px minimum spacing
  const chartContentW = chartWidth - chartPaddingLeft - chartPaddingRight;
  const minSpacing = 50 / chartContentW;
  const uniqueLabels = labels
    .sort((a, b) => a.position - b.position)
    .filter(
      (label, idx, arr) =>
        idx === 0 || Math.abs(label.position - arr[idx - 1].position) >= minSpacing
    );

  return {
    dateToX: convertDateToX,
    gaps: gapsWithPositions,
    timeAxisLabels: uniqueLabels,
  };
}

/**
 * Calculate the dynamic chart width given detected gaps and user expansion.
 *
 * Expanded gaps widen the chart by ~2 pixels per extra day (beyond the
 * compressed-gap baseline). This mirrors the pre-extraction behaviour.
 */
export function calculateChartWidth(
  dataPointCount: number,
  detectedGaps: DetectedGap[],
  expandedGaps: Set<number>,
  options: {
    minPointSpacing: number;
    baseChartWidth: number;
    maxChartWidth: number;
    chartPaddingLeft: number;
    chartPaddingRight: number;
    compressedGapDays?: number;
  }
): number {
  const {
    minPointSpacing,
    baseChartWidth,
    maxChartWidth,
    chartPaddingLeft,
    chartPaddingRight,
    compressedGapDays = DEFAULT_COMPRESSED_GAP_DAYS,
  } = options;

  let pointsWidth = dataPointCount * minPointSpacing + chartPaddingLeft + chartPaddingRight;

  if (detectedGaps.length > 0 && expandedGaps.size > 0) {
    const totalExpandedGapDays = detectedGaps
      .filter((_, idx) => expandedGaps.has(idx))
      .reduce((sum, gap) => sum + gap.gapDays - compressedGapDays, 0);
    pointsWidth += totalExpandedGapDays * 2;
  }

  return Math.min(maxChartWidth, Math.max(baseChartWidth, pointsWidth));
}
