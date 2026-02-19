import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { colors, spacing, typography, opacity, chartStyles } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import {
  sortByDateId,
  smoothDataPoints,
  getEffectiveWindow,
  formatShortDateWithWeekday,
  type SmoothingWindow,
} from '@/lib';
import type { WellnessData } from '@/types';
import type { TimeRange } from '@/hooks';

interface WellnessTrendsChartProps {
  data?: WellnessData[];
  height?: number;
  timeRange: TimeRange;
  smoothingWindow?: SmoothingWindow;
}

// Colors for different metrics (NO orange)
const METRIC_COLORS = {
  hrv: '#EC4899', // Pink-500
  rhr: '#EF4444', // Red-500 (classic HR color)
  sleep: '#A855F7', // Purple-500
  sleepScore: '#6366F1', // Indigo-500
  weight: '#64748B', // Slate-500
};

interface MetricChartData {
  x: number;
  value: number;
  date: string;
  rawValue: number;
}

function formatSleepDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
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

  const path = Skia.Path.Make();
  path.moveTo(sx(data[0].x), sy(data[0].value));

  if (data.length === 2) {
    path.lineTo(sx(data[1].x), sy(data[1].value));
    return { path, sx, sy };
  }

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

    path.cubicTo(cp1x, cp1y, cp2x, cp2y, sx(p2.x), sy(p2.value));
  }

  return { path, sx, sy };
}

export const WellnessTrendsChart = React.memo(function WellnessTrendsChart({
  data,
  height = 200,
  timeRange,
  smoothingWindow = 'auto',
}: WellnessTrendsChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Shared values for gesture
  const activeX = useSharedValue(0);
  const isActive = useSharedValue(false);

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
            value: d.weight,
            date: d.id,
            rawValue: d.weight,
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
    }, [data, effectiveWindow]);

  // Build metric configs for active metrics
  const activeMetrics: MetricConfig[] = useMemo(() => {
    const metrics: MetricConfig[] = [];
    if (hrvData.length > 0)
      metrics.push({
        key: 'hrv',
        data: hrvData,
        color: METRIC_COLORS.hrv,
        label: t('metrics.hrv'),
        unit: 'ms',
        formatValue: (v) => Math.round(v).toString(),
      });
    if (rhrData.length > 0)
      metrics.push({
        key: 'rhr',
        data: rhrData,
        color: METRIC_COLORS.rhr,
        label: t('wellness.restingHR'),
        unit: t('units.bpm'),
        formatValue: (v) => Math.round(v).toString(),
      });
    if (sleepData.length > 0)
      metrics.push({
        key: 'sleep',
        data: sleepData,
        color: METRIC_COLORS.sleep,
        label: t('wellness.sleep'),
        unit: '',
        formatValue: (v) => formatSleepDuration(v),
      });
    if (sleepScoreData.length > 0)
      metrics.push({
        key: 'sleepScore',
        data: sleepScoreData,
        color: METRIC_COLORS.sleepScore,
        label: t('wellness.sleepScore'),
        unit: '',
        formatValue: (v) => Math.round(v).toString(),
      });
    if (weightData.length > 0)
      metrics.push({
        key: 'weight',
        data: weightData,
        color: METRIC_COLORS.weight,
        label: t('wellness.weight'),
        unit: 'kg',
        formatValue: (v) => v.toFixed(1),
      });
    return metrics;
  }, [hrvData, rhrData, sleepData, sleepScoreData, weightData, t]);

  const hasAnyData = activeMetrics.length > 0;

  // Compute sparkline width from container (metricInfo=75 + metricValues=55 + 2*margin)
  const sparklineWidth = Math.max(0, containerWidth - 75 - 55 - spacing.sm * 2);

  // Calculate x position to index (for gesture)
  const leftPadding = 75 + spacing.sm;
  const chartWidth = sparklineWidth;

  const sparklineHeight = 50;

  // Build a single Skia Picture containing all sparkline paths + selection indicators
  const chartPicture = useMemo(() => {
    if (activeMetrics.length === 0 || sparklineWidth <= 0) return null;

    const totalHeight = activeMetrics.length * sparklineHeight;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sparklineWidth, totalHeight));
    const paint = Skia.Paint();
    paint.setStyle(1); // stroke
    paint.setStrokeWidth(2);
    paint.setAntiAlias(true);

    const selectionLinePaint = Skia.Paint();
    selectionLinePaint.setStyle(1);
    selectionLinePaint.setStrokeWidth(1);
    selectionLinePaint.setColor(Skia.Color(isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'));

    const circlePaint = Skia.Paint();
    circlePaint.setStyle(0); // fill
    circlePaint.setAntiAlias(true);

    // Separator paint
    const separatorPaint = Skia.Paint();
    separatorPaint.setStyle(1);
    separatorPaint.setStrokeWidth(StyleSheet.hairlineWidth);
    separatorPaint.setColor(
      Skia.Color(isDark ? opacity.overlayDark.medium : opacity.overlay.light)
    );

    for (let i = 0; i < activeMetrics.length; i++) {
      const metric = activeMetrics[i];
      const yOffset = i * sparklineHeight;

      // Compute domain with padding
      const values = metric.data.map((d) => d.value);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const range = maxValue - minValue || 1;
      const yMin = minValue - range * 0.15;
      const yMax = maxValue + range * 0.15;

      const pathData = buildSparklinePath(
        metric.data,
        sparklineWidth,
        sparklineHeight,
        yOffset,
        totalDays,
        yMin,
        yMax
      );

      if (pathData) {
        // Draw sparkline path
        paint.setColor(Skia.Color(metric.color));
        canvas.drawPath(pathData.path, paint);

        // Draw selection indicator
        if (selectedIdx !== null) {
          const selectedPoint = metric.data.find((d) => d.x === selectedIdx);
          if (selectedPoint) {
            // Vertical selection line
            canvas.drawLine(
              pathData.sx(selectedIdx),
              yOffset + SPARKLINE_PADDING.top,
              pathData.sx(selectedIdx),
              yOffset + sparklineHeight - SPARKLINE_PADDING.bottom,
              selectionLinePaint
            );
            // Selection dot
            circlePaint.setColor(Skia.Color(metric.color));
            canvas.drawCircle(
              pathData.sx(selectedPoint.x),
              pathData.sy(selectedPoint.value),
              5,
              circlePaint
            );
          }
        }
      }

      // Draw row separator (except after last row)
      if (i < activeMetrics.length - 1) {
        const separatorY = yOffset + sparklineHeight;
        canvas.drawLine(0, separatorY, sparklineWidth, separatorY, separatorPaint);
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [activeMetrics, sparklineWidth, sparklineHeight, totalDays, selectedIdx, isDark]);

  // Compute display values for each metric row
  const metricDisplayValues = useMemo(() => {
    return activeMetrics.map((metric) => {
      const latestValue = metric.data[metric.data.length - 1];
      const avgValue = metric.data.reduce((sum, d) => sum + d.rawValue, 0) / metric.data.length;
      const selectedPoint =
        selectedIdx !== null ? metric.data.find((d) => d.x === selectedIdx) || null : null;
      const displayValue = selectedPoint || latestValue;
      return {
        displayValue,
        avgValue,
        isSelected: selectedIdx !== null,
      };
    });
  }, [activeMetrics, selectedIdx]);

  const updateSelectedIdx = useCallback(
    (x: number) => {
      if (chartWidth <= 0 || totalDays <= 0) return;
      const relativeX = x - leftPadding;
      const ratio = Math.max(0, Math.min(1, relativeX / chartWidth));
      const idx = Math.round(ratio * (totalDays - 1));
      setSelectedIdx(idx);
    },
    [chartWidth, totalDays, leftPadding]
  );

  const clearSelection = useCallback(() => {
    setSelectedIdx(null);
  }, []);

  // Gesture handler
  const gesture = Gesture.Pan()
    .onStart((e) => {
      isActive.value = true;
      activeX.value = e.x;
      runOnJS(updateSelectedIdx)(e.x);
    })
    .onUpdate((e) => {
      activeX.value = e.x;
      runOnJS(updateSelectedIdx)(e.x);
    })
    .onEnd(() => {
      isActive.value = false;
      runOnJS(clearSelection)();
    })
    .minDistance(0)
    .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  // Selected date for header
  const selectedDate = useMemo(() => {
    if (selectedIdx === null || !sortedData[selectedIdx]) return null;
    return sortedData[selectedIdx].id;
  }, [selectedIdx, sortedData]);

  if (!data || data.length === 0 || !hasAnyData) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {t('wellness.noTrendData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && chartStyles.textDark]}>
            {t('wellness.trendHint')}
          </Text>
        </View>
      </View>
    );
  }

  const canvasHeight = activeMetrics.length * sparklineHeight;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* Date header - shows selected date or "Today" */}
      <View style={styles.dateHeader}>
        <Text style={[styles.dateText, isDark && styles.textLight]}>
          {selectedDate ? formatShortDateWithWeekday(selectedDate) : t('time.today')}
        </Text>
        {selectedIdx !== null && (
          <Text style={[styles.dateHint, isDark && chartStyles.textDark]}>
            {t('wellness.dragToExplore')}
          </Text>
        )}
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
                <Text style={[styles.metricLabel, isDark && chartStyles.textDark]}>
                  {metric.label}
                </Text>
              </View>

              {/* Center: spacer for sparkline area (canvas is overlaid absolutely) */}
              <View style={styles.sparklineContainer} />

              {/* Right: values */}
              <View style={styles.metricValues}>
                <Text
                  style={[
                    styles.metricValue,
                    metricDisplayValues[i]?.isSelected
                      ? { color: metric.color }
                      : isDark && styles.textLight,
                  ]}
                >
                  {metricDisplayValues[i]?.displayValue
                    ? metric.formatValue(metricDisplayValues[i].displayValue.rawValue)
                    : '-'}
                </Text>
                <Text style={[styles.metricUnit, isDark && chartStyles.textDark]}>
                  {metric.unit}
                </Text>
                {!metricDisplayValues[i]?.isSelected && (
                  <Text style={[styles.metricAvg, isDark && chartStyles.textDark]}>
                    avg {metric.formatValue(metricDisplayValues[i]?.avgValue ?? 0)}
                  </Text>
                )}
              </View>
            </View>
          ))}

          {/* Single Skia canvas overlaid on the sparkline column area */}
          {sparklineWidth > 0 && chartPicture && (
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
              </Canvas>
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Period label */}
      <Text style={[styles.periodLabel, isDark && chartStyles.textDark]}>
        {t('wellness.lastDays', { count: data.length })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
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
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
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
    borderRadius: spacing.xs,
    marginRight: spacing.xs,
  },
  metricLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    marginTop: -2,
  },
  metricAvg: {
    fontSize: typography.pillLabel.fontSize - 1,
    color: colors.textSecondary,
    marginTop: 2,
  },
  periodLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
