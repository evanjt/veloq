import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';
import { useTranslation } from 'react-i18next';
import {
  Canvas,
  DashPathEffect,
  Line as SkiaLine,
  Picture,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from '@/shared/app';
import {
  colors,
  spacing,
  typography,
  themedStyles,
  type Palette,
  stroke,
  chartStyles,
} from '@/theme';
import {
  chartLinePaint,
  chartStroke,
  ChartSurface,
  drawChartDot,
  REFERENCE_DASH,
  lanesSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  type SummarySeries,
} from '@/shared/charts';
import { sortByDateId } from '@/shared/activity/activityUtils';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { toDisplayWeight, weightUnitLabel } from '@/shared/format/weight';
import { formatShortDate, formatShortDateWithWeekday } from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';
import { DENSE_TEXT_SCALE, denseExtent } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';
import {
  smoothDataPoints,
  getEffectiveWindow,
  getSmoothingDescription,
  type SmoothingWindow,
} from '@/shared/math/smoothing';
import type { WellnessData } from '@/types';

import type { TimeRange } from '../hooks';
import { wellnessRowDomain, wellnessRowMarker, wellnessRowReading, wellnessRowStats } from '../lib';
import { EmptyState } from '@/shared/ui/EmptyState';
import { formatDecimal } from '@/shared/format';

interface WellnessTrendsChartProps {
  data?: WellnessData[] | undefined;
  height?: number | undefined;
  timeRange: TimeRange;
  smoothingWindow?: SmoothingWindow | undefined;
  onDateSelect?: ((date: string | null) => void) | undefined;
  /**
   * Whether wellness was downloaded for the range drawn. `NotFetched` turns the
   * empty state into "not downloaded". Absent, the chart claims nothing.
   */
  coverage?: RangeCoverage | undefined;
  /** The data is the previous range's, kept on screen while the new range is read. */
  held?: boolean;
}

interface MetricChartData {
  x: number;
  value: number;
  date: string;
  rawValue: number;
}

function splitSleepDuration(hours: number): { hours: number; minutes: number } {
  const totalMinutes = Math.round(hours * 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

const SPARKLINE_PADDING = { left: 4, right: 4, top: 8, bottom: 8 } as const;

interface MetricConfig {
  key: string;
  data: MetricChartData[];
  label: string;
  unit: string;
  formatValue: (v: number) => string;
}

interface RowScale {
  sx: (x: number) => number;
  sy: (y: number) => number;
}

/** A row's day index and value to canvas pixels, offset to the row's place in the combined canvas. */
function rowScale(
  width: number,
  rowHeight: number,
  yOffset: number,
  totalDays: number,
  yMin: number,
  yMax: number
): RowScale {
  const pad = SPARKLINE_PADDING;
  const cw = width - pad.left - pad.right;
  const ch = rowHeight - pad.top - pad.bottom;
  const xRange = Math.max(totalDays - 1, 1);
  const yRange = yMax - yMin || 1;
  return {
    sx: (x: number) => pad.left + (x / xRange) * cw,
    sy: (y: number) => yOffset + pad.top + ((yMax - y) / yRange) * ch,
  };
}

/**
 * Build a smooth Skia path from data points using Catmull-Rom → cubic Bezier conversion.
 * The curve passes through every point, so a dot at a point's value sits on it.
 */
function buildSparklinePath(
  data: MetricChartData[],
  { sx, sy }: RowScale
): ReturnType<typeof Skia.Path.Make> | null {
  if (data.length < 2) return null;

  // Build the "d" string for Skia.Path.MakeFromSVGString - the imperative
  // Skia.Path.Make().moveTo()/cubicTo() API is deprecated in react-native-skia 2.x.
  let d = `M${sx(data[0].x)} ${sy(data[0].value)}`;

  if (data.length === 2) {
    d += `L${sx(data[1].x)} ${sy(data[1].value)}`;
  } else {
    // Catmull-Rom to cubic Bezier for smooth curves
    for (let i = 0; i < data.length - 1; i++) {
      const p0 = i > 0 ? data[i - 1] : data[i];
      const p1 = data[i];
      const p2 = data[i + 1];
      const p3 = i < data.length - 2 ? data[i + 2] : data[i + 1];

      const cp1x = sx(p1.x) + (sx(p2.x) - sx(p0.x)) / 6;
      const cp1y = sy(p1.value) + (sy(p2.value) - sy(p0.value)) / 6;
      const cp2x = sx(p2.x) - (sx(p3.x) - sx(p1.x)) / 6;
      const cp2y = sy(p2.value) - (sy(p3.value) - sy(p1.value)) / 6;

      d += `C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${sx(p2.x)} ${sy(p2.value)}`;
    }
  }

  return Skia.Path.MakeFromSVGString(d);
}

export const WellnessTrendsChart = React.memo(function WellnessTrendsChart({
  data,
  height = 200,
  timeRange,
  smoothingWindow = 'auto',
  onDateSelect,
  coverage,
  held = false,
}: WellnessTrendsChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  // The sparkline column as the first row lays it out, which places the one canvas over every row.
  const [sparklineColumn, setSparklineColumn] = useState({ left: 0, width: 0 });
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT);
  // The hint names the gesture until the reader has found it.
  const [explored, setExplored] = useState(false);

  // Calculate effective smoothing window
  const effectiveWindow = useMemo(
    () => getEffectiveWindow(smoothingWindow, timeRange),
    [smoothingWindow, timeRange]
  );

  // Process data for each metric
  const { sortedData, hrvData, rhrData, sleepData, sleepScoreData, weightData, totalDays } =
    useMemo(() => {
      if (!data || data.length === 0) {
        return {
          sortedData: [],
          hrvData: [],
          rhrData: [],
          sleepData: [],
          sleepScoreData: [],
          weightData: [],
          totalDays: 0,
        };
      }

      // Sort by date ascending
      const sorted = sortByDateId(data);
      const totalDays = sorted.length;

      const hrvDataRaw: MetricChartData[] = [];
      const rhrDataRaw: MetricChartData[] = [];
      const sleepDataRaw: MetricChartData[] = [];
      const sleepScoreDataRaw: MetricChartData[] = [];
      const weightDataRaw: MetricChartData[] = [];

      sorted.forEach((d, idx) => {
        if (d.hrv != null) {
          hrvDataRaw.push({ x: idx, value: d.hrv, date: d.id, rawValue: d.hrv });
        }
        if (d.restingHR != null) {
          rhrDataRaw.push({
            x: idx,
            value: d.restingHR,
            date: d.id,
            rawValue: d.restingHR,
          });
        }
        if (d.sleepSecs != null) {
          const hours = d.sleepSecs / 3600;
          sleepDataRaw.push({
            x: idx,
            value: hours,
            date: d.id,
            rawValue: hours,
          });
        }
        if (d.sleepScore != null) {
          sleepScoreDataRaw.push({
            x: idx,
            value: d.sleepScore,
            date: d.id,
            rawValue: d.sleepScore,
          });
        }
        if (d.weight != null) {
          weightDataRaw.push({
            x: idx,
            value: toDisplayWeight(d.weight, isMetric),
            date: d.id,
            rawValue: toDisplayWeight(d.weight, isMetric),
          });
        }
      });

      // Apply smoothing
      const hrvData = smoothDataPoints(hrvDataRaw, effectiveWindow);
      const rhrData = smoothDataPoints(rhrDataRaw, effectiveWindow);
      const sleepData = smoothDataPoints(sleepDataRaw, effectiveWindow);
      const sleepScoreData = smoothDataPoints(sleepScoreDataRaw, effectiveWindow);
      const weightData = smoothDataPoints(weightDataRaw, effectiveWindow);

      return {
        sortedData: sorted,
        hrvData,
        rhrData,
        sleepData,
        sleepScoreData,
        weightData,
        totalDays,
      };
    }, [data, effectiveWindow, isMetric]);

  // Build metric configs for active metrics
  const activeMetrics: MetricConfig[] = useMemo(() => {
    const metrics: MetricConfig[] = [];
    if (hrvData.length > 0)
      metrics.push({
        key: 'hrv',
        data: hrvData,
        label: t('metrics.hrv'),
        unit: t('units.ms'),
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (rhrData.length > 0)
      metrics.push({
        key: 'rhr',
        data: rhrData,
        label: t('wellness.restingHR'),
        unit: t('units.bpm'),
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (sleepData.length > 0)
      metrics.push({
        key: 'sleep',
        data: sleepData,
        label: t('wellness.sleep'),
        unit: '',
        formatValue: (v) => t('wellness.sleepDuration', splitSleepDuration(v)),
      });
    if (sleepScoreData.length > 0)
      metrics.push({
        key: 'sleepScore',
        data: sleepScoreData,
        label: t('wellness.sleepScore'),
        unit: '',
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (weightData.length > 0)
      metrics.push({
        key: 'weight',
        data: weightData,
        label: t('wellness.weight'),
        unit: weightUnitLabel(isMetric),
        formatValue: (v) => formatDecimal(v, 1),
      });
    return metrics;
  }, [hrvData, rhrData, sleepData, sleepScoreData, weightData, t, isMetric]);

  const hasAnyData = activeMetrics.length > 0;

  // What a screen reader hears and the Show data sheet lists: each drawn row, day by day.
  const reading = useMemo(() => {
    const title = t('wellnessScreen.trends');
    const lanes: SummarySeries[] = activeMetrics.map((metric) => {
      const byDay = new Map(metric.data.map((d) => [d.x, d.value]));
      return {
        name: metric.label,
        unit: metric.unit || undefined,
        points: sortedData.map((day, idx) => ({
          label: formatShortDate(day.id),
          key: day.id,
          value: byDay.get(idx),
        })),
        format: (v) =>
          metric.unit ? `${metric.formatValue(v)} ${metric.unit}` : metric.formatValue(v),
      };
    });
    return {
      summary: lanesSummary(title, lanes, t),
      table: seriesTable(title, t('charts.column.date'), lanes),
    };
  }, [activeMetrics, sortedData, t]);

  const sparklineWidth = sparklineColumn.width;
  const leftPadding = sparklineColumn.left;
  const chartWidth = sparklineWidth;

  const sparklineHeight = rowHeight;

  // Where each day sits across the whole row, so the shared scrub snaps to the
  // day under the finger and the hold gives the same tick as every other chart.
  const dayXCoords = useMemo(() => {
    if (chartWidth <= 0 || totalDays <= 0) return [];
    const xRange = Math.max(totalDays - 1, 1);
    const plotWidth = chartWidth - SPARKLINE_PADDING.left - SPARKLINE_PADDING.right;
    return sortedData.map(
      (_, idx) => leftPadding + SPARKLINE_PADDING.left + (idx / xRange) * plotWidth
    );
  }, [chartWidth, totalDays, leftPadding, sortedData]);

  const handleSelect = useCallback(
    (day: WellnessData) => {
      onDateSelect?.(day.id);
    },
    [onDateSelect]
  );

  const handleInteractionChange = useCallback(
    (active: boolean) => {
      if (active) setExplored(true);
      else onDateSelect?.(null);
    },
    [onDateSelect]
  );

  const describeDay = useCallback(
    (day: WellnessData, idx: number) =>
      [
        formatShortDateWithWeekday(day.id),
        ...activeMetrics.map((metric) => {
          const reading = wellnessRowReading(metric.data, idx);
          if (!reading) return t('systemSurfaces.spoken.noReading', { label: metric.label });
          const value = metric.formatValue(reading.value);
          return metric.unit
            ? `${metric.label} ${value} ${metric.unit}`
            : `${metric.label} ${value}`;
        }),
      ].join(', '),
    [activeMetrics, t]
  );

  const {
    gesture,
    selectedPoint: selectedDay,
    syncXCoords,
    accessibilityProps,
  } = useChartGestures<WellnessData>({
    data: sortedData,
    accessibilityLabel: t('wellnessScreen.trends'),
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
    describePoint: describeDay,
  });

  useEffect(() => {
    syncXCoords(dayXCoords, (x) => x);
  }, [syncXCoords, dayXCoords]);

  const selectedIdx = useMemo(
    () => (selectedDay ? sortedData.indexOf(selectedDay) : null),
    [selectedDay, sortedData]
  );

  // Geometry is what the scrub does not move, so it is built once per data or
  // layout change and both pictures below read it.
  const metricGeometry = useMemo(() => {
    if (activeMetrics.length === 0 || sparklineWidth <= 0) return null;
    return activeMetrics.map((metric, i) => {
      const yOffset = i * sparklineHeight;
      const domain = wellnessRowDomain(metric.data);
      const scale = rowScale(
        sparklineWidth,
        sparklineHeight,
        yOffset,
        totalDays,
        domain.min,
        domain.max
      );
      const stats = wellnessRowStats(metric.data);
      return {
        metric,
        yOffset,
        scale,
        path: buildSparklinePath(metric.data, scale),
        averageY: stats ? scale.sy(stats.average) : null,
      };
    });
  }, [activeMetrics, sparklineWidth, sparklineHeight, totalDays]);

  // The sparklines, every row in the one series colour since the row label
  // names it. Nothing here depends on the selection, so a scrub tick
  // re-records none of it.
  const chartPicture = useMemo(() => {
    if (!metricGeometry) return null;

    const totalHeight = metricGeometry.length * sparklineHeight;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sparklineWidth, totalHeight));
    const linePaint = chartLinePaint(chartColors.series);
    for (const { path } of metricGeometry) {
      if (path) canvas.drawPath(path, linePaint);
    }
    return recorder.finishRecordingAsPicture();
  }, [metricGeometry, sparklineWidth, sparklineHeight, chartColors.series]);

  // The selection line and dots, the only thing a scrub tick redraws.
  const selectionPicture = useMemo(() => {
    if (!metricGeometry || selectedIdx === null) return null;

    const totalHeight = metricGeometry.length * sparklineHeight;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sparklineWidth, totalHeight));

    const linePaint = Skia.Paint();
    linePaint.setStyle(1);
    linePaint.setStrokeWidth(chartStroke.crosshair);
    linePaint.setColor(Skia.Color(chartColors.crosshair));

    for (const { metric, yOffset, scale } of metricGeometry) {
      const marker = wellnessRowMarker(metric.data, selectedIdx);
      if (!marker) continue;
      canvas.drawLine(
        scale.sx(selectedIdx),
        yOffset + SPARKLINE_PADDING.top,
        scale.sx(selectedIdx),
        yOffset + sparklineHeight - SPARKLINE_PADDING.bottom,
        linePaint
      );
      drawChartDot(
        canvas,
        { x: scale.sx(marker.x), y: scale.sy(marker.value) },
        chartColors.series,
        chartColors.surface
      );
    }

    return recorder.finishRecordingAsPicture();
  }, [metricGeometry, sparklineWidth, sparklineHeight, selectedIdx, chartColors]);

  const smoothingDescription = getSmoothingDescription(smoothingWindow, timeRange, t as never);

  // What each row prints: its own range and period average, the day's reading,
  // and while scrubbing under smoothing the line's value the dot sits on.
  const metricDisplayValues = useMemo(() => {
    return activeMetrics.map((metric) => {
      const stats = wellnessRowStats(metric.data);
      const isSelected = selectedIdx !== null;
      const displayValue = wellnessRowReading(metric.data, selectedIdx);
      const marker = effectiveWindow > 0 ? wellnessRowMarker(metric.data, selectedIdx) : null;
      const withUnit = (v: number) =>
        metric.unit ? `${metric.formatValue(v)} ${metric.unit}` : metric.formatValue(v);
      return {
        displayValue,
        avgValue: stats?.average ?? null,
        range: stats ? `${metric.formatValue(stats.low)}-${withUnit(stats.high)}` : null,
        smoothedText: marker ? `${smoothingDescription} ${metric.formatValue(marker.value)}` : null,
        isSelected,
      };
    });
  }, [activeMetrics, selectedIdx, effectiveWindow, smoothingDescription]);

  // At rest the header names the newest reading across the rows, and a row whose
  // own reading is older carries its date, so no stale value reads as today's.
  const newestReadingDate = useMemo(
    () =>
      activeMetrics.reduce<string | null>((newest, metric) => {
        const date = metric.data[metric.data.length - 1]?.date;
        return date && (!newest || date > newest) ? date : newest;
      }, null),
    [activeMetrics]
  );

  const onSparklineLayout = useCallback((e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setSparklineColumn((current) =>
      current.left === x && current.width === width ? current : { left: x, width }
    );
  }, []);

  // Every row takes the tallest row's height, so the one canvas behind them keeps a sparkline
  // per row however far the system text size grows the values column.
  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = Math.ceil(e.nativeEvent.layout.height);
    setRowHeight((current) => (measured > current ? measured : current));
  }, []);

  const selectedDate = selectedDay?.id ?? null;

  if (!data || data.length === 0 || !hasAnyData) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          {coverage === RangeCoverage.NotFetched ? (
            <EmptyState
              variant="inline"
              testID="wellness-trends-not-downloaded"
              title={t('stats.rangeNotDownloaded')}
            />
          ) : (
            <EmptyState
              variant="inline"
              title={t('wellness.noTrendData')}
              description={t('wellness.trendHint')}
            />
          )}
        </View>
      </View>
    );
  }

  const canvasHeight = activeMetrics.length * sparklineHeight;

  return (
    <View style={styles.container}>
      {/* Date header - the scrubbed day, or at rest the newest reading */}
      <View style={styles.dateHeader}>
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.dateText, isDark && styles.textLight]}
        >
          {selectedDate
            ? formatShortDateWithWeekday(selectedDate)
            : newestReadingDate
              ? formatShortDateWithWeekday(newestReadingDate)
              : t('time.today')}
        </Text>
        {!explored && (
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={styles.dateHint}
            testID="wellness-explore-hint"
          >
            {t('wellness.dragToExplore')}
          </Text>
        )}
      </View>

      <ChartSurface
        summary={reading.summary}
        table={reading.table}
        style={styles.lanes}
        held={held}
      >
        <GestureDetector gesture={gesture}>
          <View testID="wellness-trends-surface" {...accessibilityProps}>
            {activeMetrics.map((metric, i) => (
              <View
                key={metric.key}
                testID={`wellness-row-${metric.key}`}
                onLayout={onRowLayout}
                style={[
                  styles.metricRow,
                  { minHeight: rowHeight },
                  i === activeMetrics.length - 1 && styles.metricRowLast,
                ]}
              >
                {/* Left: the label, which names the row's line, and the row's own range */}
                <View style={styles.metricInfo}>
                  <Text
                    maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                    style={[
                      chartStyles.chartLabelStrong,
                      isDark && chartStyles.chartLabelStrongDark,
                    ]}
                  >
                    {metric.label}
                  </Text>
                  {metricDisplayValues[i]?.range ? (
                    <FitText
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      testID={`wellness-range-${metric.key}`}
                      style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
                    >
                      {metricDisplayValues[i].range}
                    </FitText>
                  ) : null}
                </View>

                {/* Center: the sparkline column, measured by the first row; the canvas overlays it */}
                <View
                  style={styles.sparklineContainer}
                  testID={`wellness-sparkline-column-${metric.key}`}
                  onLayout={i === 0 ? onSparklineLayout : undefined}
                />

                {/* Right: values */}
                <View style={styles.metricValues}>
                  <FitText
                    maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                    testID={`wellness-value-${metric.key}`}
                    style={[styles.metricValue, isDark && styles.textLight]}
                  >
                    {metricDisplayValues[i]?.displayValue
                      ? metric.formatValue(metricDisplayValues[i].displayValue.value)
                      : ABSENT}
                  </FitText>
                  {metric.unit ? (
                    <FitText maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.metricUnit}>
                      {metric.unit}
                    </FitText>
                  ) : null}
                  {metricDisplayValues[i]?.isSelected ? (
                    metricDisplayValues[i].smoothedText ? (
                      <FitText
                        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                        testID={`wellness-smoothed-${metric.key}`}
                        style={styles.metricAvg}
                      >
                        {metricDisplayValues[i].smoothedText}
                      </FitText>
                    ) : null
                  ) : metricDisplayValues[i]?.avgValue != null ? (
                    <FitText
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      testID={`wellness-average-${metric.key}`}
                      style={styles.metricAvg}
                    >
                      {t('sections.avg')} {metric.formatValue(metricDisplayValues[i].avgValue)}
                    </FitText>
                  ) : null}
                  {!metricDisplayValues[i]?.isSelected &&
                  metricDisplayValues[i]?.displayValue &&
                  metricDisplayValues[i].displayValue.date !== newestReadingDate ? (
                    <FitText maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.metricAvg}>
                      {formatShortDate(metricDisplayValues[i].displayValue.date)}
                    </FitText>
                  ) : null}
                </View>
              </View>
            ))}

            {/* Single Skia canvas overlaid on the sparkline column area */}
            {sparklineWidth > 0 && chartPicture ? (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: sparklineColumn.left,
                  width: sparklineWidth,
                  height: canvasHeight,
                }}
                pointerEvents="none"
              >
                <Canvas style={{ width: sparklineWidth, height: canvasHeight }}>
                  {/* Each row's period average, a dashed reference rule under its line */}
                  {metricGeometry?.map(({ metric, averageY }) =>
                    averageY === null ? null : (
                      <SkiaLine
                        key={metric.key}
                        p1={vec(SPARKLINE_PADDING.left, averageY)}
                        p2={vec(sparklineWidth - SPARKLINE_PADDING.right, averageY)}
                        color={chartColors.reference}
                        strokeWidth={chartStroke.reference}
                      >
                        <DashPathEffect intervals={REFERENCE_DASH} />
                      </SkiaLine>
                    )
                  )}
                  <Picture picture={chartPicture} />
                  {selectionPicture ? <Picture picture={selectionPicture} /> : null}
                </Canvas>
              </View>
            ) : null}
          </View>
        </GestureDetector>
      </ChartSurface>

      {/* The period drawn and the smoothing the lines carry, named once under the rows */}
      <Text
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={styles.periodLabel}
        testID="wellness-period-label"
      >
        {`${t('wellness.lastDays', { count: data.length })} · ${smoothingDescription}`}
      </Text>
    </View>
  );
});

/** A row's height at the default text size; a row grows past it when its values need more. */
const MIN_ROW_HEIGHT = 50;
/** The label column fits about nine characters of the label at the cap, and wraps past that. */
const LABEL_COLUMN_WIDTH = denseExtent(typography.caption.fontSize, 5.4);
/** The value column fits a five-figure reading such as "103.4" at the cap. */
const VALUE_COLUMN_WIDTH = denseExtent(typography.pillValue.fontSize, 3);

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    // The rows set their own height, so the plot is sized by them rather than filling.
    lanes: {
      flex: 0,
    },
    dateHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    dateText: {
      ...typography.bodySmallBold,
      color: colors.textPrimary,
    },
    dateHint: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
    },
    textLight: {
      color: colors.textOnFill,
    },
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderBottomWidth: stroke.hairline,
      borderBottomColor: palette.border,
    },
    metricRowLast: {
      borderBottomWidth: 0,
    },
    metricInfo: {
      width: LABEL_COLUMN_WIDTH,
    },
    sparklineContainer: {
      flex: 1,
      marginHorizontal: spacing.sm,
    },
    metricValues: {
      alignItems: 'flex-end',
      width: VALUE_COLUMN_WIDTH,
    },
    metricValue: {
      ...typography.pillValue,
      color: colors.textPrimary,
    },
    metricUnit: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    metricAvg: {
      ...typography.caption,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
    periodLabel: {
      ...typography.caption,
      color: palette.textSecondary,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
