/**
 * Histogram plot of the engine's attempt-time bins for one direction.
 * Fastest attempts are at the left. Bars, ticks and marks are placed from the
 * engine's bins alone; nothing is binned here.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Rect } from '@shopify/react-native-skia';

import { useMetricSystem } from '@/shared/app';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { formatDuration } from '@/shared/format/format';
import { layoutHistogram } from '@/features/routes/lib/histogramLayout';
import { formatSectionSpeed } from '@/features/routes/lib/sectionSpeedFormat';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import type { FfiAttemptHistogram } from 'veloqrs';
import type { ActivityType } from '@/types';

/** Horizontal room the chart leaves at the window edge, as the scatter does. */
const CHART_INSET = 32;
const CHART_HEIGHT = 120;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;
const MARK_WIDTH = 2;
const GRID_THICKNESS = 1;

export interface AttemptHistogramChartProps {
  histogram: FfiAttemptHistogram;
  activityType: ActivityType;
  isDark: boolean;
  /** Label the bin edges as durations, for a route, rather than as pace or speed. */
  useTimeAxis?: boolean | undefined;
  /** Time in seconds of the highlighted attempt, when it is in this direction. */
  highlightedTime?: number | null | undefined;
  /** Time in seconds of this direction's record. */
  recordTime?: number | null | undefined;
}

export function AttemptHistogramChart({
  histogram,
  activityType,
  isDark,
  useTimeAxis,
  highlightedTime,
  recordTime,
}: AttemptHistogramChartProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - CHART_INSET;
  const palette = isDark ? darkColors : colors;

  const plot = useMemo(
    () =>
      layoutHistogram(histogram, {
        width: chartWidth,
        height: CHART_HEIGHT,
        padding: CHART_PADDING,
      }),
    [histogram, chartWidth]
  );

  const edgeLabels = useMemo(() => {
    const edges = histogram.counts.length;
    const at = [0, Math.floor(edges / 2), edges];
    return at.map((edge) => {
      const speed = histogram.edgeSpeeds?.[edge];
      if (!useTimeAxis && speed !== undefined) {
        return formatSectionSpeed(speed, activityType, isMetric);
      }
      return formatDuration(histogram.startSecs + edge * histogram.binWidthSecs);
    });
  }, [histogram, useTimeAxis, activityType, isMetric]);

  const highlightX =
    highlightedTime != null && Number.isFinite(highlightedTime)
      ? plot.xForTime(highlightedTime)
      : null;
  const recordX =
    recordTime != null && Number.isFinite(recordTime) ? plot.xForTime(recordTime) : null;
  const plotTop = CHART_PADDING.top;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  return (
    <View testID="attempt-histogram" style={[styles.container, isDark && styles.containerDark]}>
      <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
        <Canvas style={StyleSheet.absoluteFill}>
          {plot.countTicks.map((tick) => (
            <Rect
              key={`grid-${tick.count}`}
              x={CHART_PADDING.left}
              y={tick.y}
              width={chartWidth - CHART_PADDING.left - CHART_PADDING.right}
              height={GRID_THICKNESS}
              color={palette.border}
            />
          ))}
          {plot.bars.map((bar, i) => (
            <Rect
              key={`bar-${i}`}
              x={bar.x + 1}
              y={bar.y}
              width={Math.max(0, bar.width - 2)}
              height={bar.height}
              color={palette.primary}
              opacity={0.7}
            />
          ))}
          {recordX !== null && (
            <Rect
              x={recordX - MARK_WIDTH / 2}
              y={plotTop}
              width={MARK_WIDTH}
              height={plotHeight}
              color={palette.chartGoldMark}
            />
          )}
          {highlightX !== null && (
            <Rect
              x={highlightX - MARK_WIDTH / 2}
              y={plotTop}
              width={MARK_WIDTH}
              height={plotHeight}
              color={palette.chartGreenMark}
            />
          )}
        </Canvas>
        <View style={styles.yAxisOverlay} pointerEvents="none">
          {plot.countTicks.map((tick) => (
            <Text
              key={tick.count}
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark, { top: tick.y - 14 }]}
            >
              {tick.count}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.edgeAxis}>
        {edgeLabels.map((label, i) => (
          <Text
            key={i}
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.edgeLabel, isDark && styles.axisLabelDark]}
          >
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.key}>
        {highlightedTime != null && (
          <KeyEntry
            color={palette.chartGreenMark}
            label={t('sections.legendThisActivity')}
            isDark={isDark}
          />
        )}
        <KeyEntry color={palette.chartGoldMark} label={t('sections.legendPr')} isDark={isDark} />
      </View>
      <Text
        testID="attempt-histogram-caption"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.caption, isDark && styles.axisLabelDark]}
      >
        {t('sections.histogramBinned', { attempts: histogram.binned })}
      </Text>
      {histogram.unbinnedOutsideBand > 0 && (
        <Text
          testID="attempt-histogram-outside-band"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.axisLabelDark]}
        >
          {t('sections.histogramOutsideBand', { attempts: histogram.unbinnedOutsideBand })}
        </Text>
      )}
    </View>
  );
}

function KeyEntry({ color, label, isDark }: { color: string; label: string; isDark: boolean }) {
  return (
    <View style={styles.keyEntry}>
      <View style={[styles.keySwatch, { backgroundColor: color }]} />
      <Text style={[styles.keyText, isDark && styles.axisLabelDark]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
    paddingBottom: spacing.xs,
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  yAxisOverlay: {
    ...StyleSheet.absoluteFill,
  },
  axisLabel: {
    position: 'absolute',
    left: CHART_PADDING.left + 2,
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
  },
  edgeLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
  },
  key: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  keyEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  keySwatch: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  keyText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  caption: {
    textAlign: 'center',
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
});
