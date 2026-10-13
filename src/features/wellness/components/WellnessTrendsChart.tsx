import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from '@/shared/app';
import {
  colors,
  spacing,
  layout,
  typography,
  opacity,
  colorWithOpacity,
  ink,
  themedStyles,
  type Palette,
} from '@/theme';
import { useChartColors, useChartGestures } from '@/shared/charts';
import { sortByDateId } from '@/shared/activity/activityUtils';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { toDisplayWeight, weightUnitLabel } from '@/shared/format/weight';
import { formatShortDate, formatShortDateWithWeekday } from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';
import {
  smoothDataPoints,
  getEffectiveWindow,
  type SmoothingWindow,
} from '@/shared/math/smoothing';
import type { WellnessData } from '@/types';

import type { TimeRange } from '../hooks';
import { wellnessRowDomain, wellnessRowReading } from '../lib';
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
  color: string;
  label: string;
  unit: string;
  formatValue: (v: number) => string;
}

/**
 * Build a smooth Skia path from data points using Catmull-Rom → cubic Bezier conversion.
 * Returns the path offset to a given yOffset within the combined canvas.
 */
function buildSparklinePath(
  data: MetricChartData[],
  width: number,
  rowHeight: number,
  yOffset: number,
  totalDays: number,
  yMin: number,
  yMax: number
): {
  path: ReturnType<typeof Skia.Path.Make>;
  sx: (x: number) => number;
  sy: (y: number) => number;
} | null {
  if (data.length < 2 || width <= 0) return null;

  const pad = SPARKLINE_PADDING;
  const cw = width - pad.left - pad.right;
  const ch = rowHeight - pad.top - pad.bottom;
  const xRange = Math.max(totalDays - 1, 1);
  const yRange = yMax - yMin || 1;

  const sx = (x: number) => pad.left + (x / xRange) * cw;
  const sy = (y: number) => yOffset + pad.top + ((yMax - y) / yRange) * ch;

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

  const path = Skia.Path.MakeFromSVGString(d);
  if (!path) return null;

  return { path, sx, sy };
}

export const WellnessTrendsChart = React.memo(function WellnessTrendsChart({
  data,
  height = 200,
  timeRange,
  smoothingWindow = 'auto',
  onDateSelect,
  coverage,
}: WellnessTrendsChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  const [containerWidth, setContainerWidth] = useState(0);

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
        color: chartColors.hrv,
        label: t('metrics.hrv'),
        unit: t('units.ms'),
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (rhrData.length > 0)
      metrics.push({
        key: 'rhr',
        data: rhrData,
        color: chartColors.rhr,
        label: t('wellness.restingHR'),
        unit: t('units.bpm'),
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (sleepData.length > 0)
      metrics.push({
        key: 'sleep',
        data: sleepData,
        color: chartColors.sleep,
        label: t('wellness.sleep'),
        unit: '',
        formatValue: (v) => t('wellness.sleepDuration', splitSleepDuration(v)),
      });
    if (sleepScoreData.length > 0)
      metrics.push({
        key: 'sleepScore',
        data: sleepScoreData,
        color: chartColors.sleepScore,
        label: t('wellness.sleepScore'),
        unit: '',
        formatValue: (v) => formatDecimal(v, 0),
      });
    if (weightData.length > 0)
      metrics.push({
        key: 'weight',
        data: weightData,
        color: chartColors.weight,
        label: t('wellness.weight'),
        unit: weightUnitLabel(isMetric),
        formatValue: (v) => formatDecimal(v, 1),
      });
    return metrics;
  }, [hrvData, rhrData, sleepData, sleepScoreData, weightData, chartColors, t, isMetric]);

  const hasAnyData = activeMetrics.length > 0;

  // Compute sparkline width from container (metricInfo=75 + metricValues=55 + 2*margin)
  const sparklineWidth = Math.max(0, containerWidth - 75 - 55 - spacing.sm * 2);

  // Calculate x position to index (for gesture)
  const leftPadding = 75 + spacing.sm;
  const chartWidth = sparklineWidth;

  const sparklineHeight = 50;

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
      if (!active) onDateSelect?.(null);
    },
    [onDateSelect]
  );

  const {
    gesture,
    selectedPoint: selectedDay,
    syncXCoords,
  } = useChartGestures<WellnessData>({
    data: sortedData,
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
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
      return {
        metric,
        yOffset,
        path: buildSparklinePath(
          metric.data,
          sparklineWidth,
          sparklineHeight,
          yOffset,
          totalDays,
          domain.min,
          domain.max
        ),
      };
    });
  }, [activeMetrics, sparklineWidth, sparklineHeight, totalDays]);

  // The sparklines and the row separators. Nothing here depends on the
  // selection, so a scrub tick re-records none of it.
  const chartPicture = useMemo(() => {
    if (!metricGeometry) return null;

    const totalHeight = metricGeometry.length * sparklineHeight;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sparklineWidth, totalHeight));

    const paint = Skia.Paint();
    paint.setStyle(1); // stroke
    paint.setStrokeWidth(2);
    paint.setAntiAlias(true);

    const separatorPaint = Skia.Paint();
    separatorPaint.setStyle(1);
    separatorPaint.setStrokeWidth(StyleSheet.hairlineWidth);
    separatorPaint.setColor(
      Skia.Color(isDark ? opacity.overlayDark.medium : opacity.overlay.light)
    );

    metricGeometry.forEach(({ metric, yOffset, path }, i) => {
      if (path) {
        paint.setColor(Skia.Color(metric.color));
        canvas.drawPath(path.path, paint);
      }
      if (i < metricGeometry.length - 1) {
        const separatorY = yOffset + sparklineHeight;
        canvas.drawLine(0, separatorY, sparklineWidth, separatorY, separatorPaint);
      }
    });

    return recorder.finishRecordingAsPicture();
  }, [metricGeometry, sparklineWidth, sparklineHeight, isDark]);

  // The selection line and dots, the only thing a scrub tick redraws.
  const selectionPicture = useMemo(() => {
    if (!metricGeometry || selectedIdx === null) return null;

    const totalHeight = metricGeometry.length * sparklineHeight;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sparklineWidth, totalHeight));

    const linePaint = Skia.Paint();
    linePaint.setStyle(1);
    linePaint.setStrokeWidth(1);
    linePaint.setColor(
      Skia.Color(isDark ? colorWithOpacity(ink.white, 0.3) : colorWithOpacity(ink.black, 0.2))
    );

    const circlePaint = Skia.Paint();
    circlePaint.setStyle(0); // fill
    circlePaint.setAntiAlias(true);

    for (const { metric, yOffset, path } of metricGeometry) {
      if (!path) continue;
      const reading = wellnessRowReading(metric.data, selectedIdx);
      if (!reading) continue;
      canvas.drawLine(
        path.sx(selectedIdx),
        yOffset + SPARKLINE_PADDING.top,
        path.sx(selectedIdx),
        yOffset + sparklineHeight - SPARKLINE_PADDING.bottom,
        linePaint
      );
      circlePaint.setColor(Skia.Color(metric.color));
      canvas.drawCircle(path.sx(reading.x), path.sy(reading.value), 5, circlePaint);
    }

    return recorder.finishRecordingAsPicture();
  }, [metricGeometry, sparklineWidth, sparklineHeight, selectedIdx, isDark]);

  // Compute display values for each metric row
  const metricDisplayValues = useMemo(() => {
    return activeMetrics.map((metric) => {
      const avgValue =
        metric.data.length > 0
          ? metric.data.reduce((sum, d) => sum + d.rawValue, 0) / metric.data.length
          : null;
      const isSelected = selectedIdx !== null;
      const displayValue = wellnessRowReading(metric.data, selectedIdx);
      return { displayValue, avgValue, isSelected };
    });
  }, [activeMetrics, selectedIdx]);

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

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
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
    <View style={styles.container} onLayout={onLayout}>
      {/* Date header - the scrubbed day, or at rest the newest reading */}
      <View style={styles.dateHeader}>
        <Text style={[styles.dateText, isDark && styles.textLight]}>
          {selectedDate
            ? formatShortDateWithWeekday(selectedDate)
            : newestReadingDate
              ? formatShortDateWithWeekday(newestReadingDate)
              : t('time.today')}
        </Text>
        {selectedIdx !== null && <Text style={styles.dateHint}>{t('wellness.dragToExplore')}</Text>}
      </View>

      <GestureDetector gesture={gesture}>
        <View>
          {activeMetrics.map((metric, i) => (
            <View
              key={metric.key}
              style={[
                styles.metricRow,
                isDark && styles.metricRowDark,
                i === activeMetrics.length - 1 && styles.metricRowLast,
              ]}
            >
              {/* Left: label */}
              <View style={styles.metricInfo}>
                <View style={[styles.metricDot, { backgroundColor: metric.color }]} />
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>

              {/* Center: spacer for sparkline area (canvas is overlaid absolutely) */}
              <View style={styles.sparklineContainer} />

              {/* Right: values */}
              <View style={styles.metricValues}>
                <Text style={[styles.metricValue, isDark && styles.textLight]}>
                  {metricDisplayValues[i]?.displayValue
                    ? metric.formatValue(metricDisplayValues[i].displayValue.value)
                    : ABSENT}
                </Text>
                <Text style={styles.metricUnit}>{metric.unit}</Text>
                {!metricDisplayValues[i]?.isSelected &&
                  metricDisplayValues[i]?.avgValue != null && (
                    <Text style={styles.metricAvg}>
                      {t('sections.avg')} {metric.formatValue(metricDisplayValues[i].avgValue)}
                    </Text>
                  )}
                {!metricDisplayValues[i]?.isSelected &&
                metricDisplayValues[i]?.displayValue &&
                metricDisplayValues[i].displayValue.date !== newestReadingDate ? (
                  <Text style={styles.metricAvg}>
                    {formatShortDate(metricDisplayValues[i].displayValue.date)}
                  </Text>
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
                left: 75 + spacing.sm,
                width: sparklineWidth,
                height: canvasHeight,
              }}
              pointerEvents="none"
            >
              <Canvas style={{ width: sparklineWidth, height: canvasHeight }}>
                <Picture picture={chartPicture} />
                {selectionPicture ? <Picture picture={selectionPicture} /> : null}
              </Canvas>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {/* Period label */}
      <Text style={styles.periodLabel}>{t('wellness.lastDays', { count: data.length })}</Text>
    </View>
  );
});

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    dateHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    dateText: {
      fontSize: typography.bodySmall.fontSize,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    dateHint: {
      fontSize: typography.micro.fontSize,
      color: palette.textSecondary,
      fontStyle: 'italic',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
    },
    textLight: {
      color: colors.textOnDark,
    },
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 50,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: opacity.overlay.light,
    },
    metricRowDark: {
      borderBottomColor: opacity.overlayDark.medium,
    },
    metricRowLast: {
      borderBottomWidth: 0,
    },
    metricInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      width: 75,
    },
    metricDot: {
      width: spacing.sm,
      height: spacing.sm,
      borderRadius: layout.borderRadiusXs,
      marginRight: spacing.xs,
    },
    metricLabel: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
      fontWeight: '500',
    },
    sparklineContainer: {
      flex: 1,
      marginHorizontal: spacing.sm,
    },
    metricValues: {
      alignItems: 'flex-end',
      width: 55,
    },
    metricValue: {
      fontSize: typography.bodySmall.fontSize + 1,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    metricUnit: {
      fontSize: typography.pillLabel.fontSize,
      color: palette.textSecondary,
      marginTop: -spacing.xxs,
    },
    metricAvg: {
      fontSize: typography.pillLabel.fontSize - 1,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
    periodLabel: {
      fontSize: typography.micro.fontSize,
      color: palette.textSecondary,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
