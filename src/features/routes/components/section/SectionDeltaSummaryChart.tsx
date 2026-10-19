/**
 * Delta plot of the typical attempt for one direction, shown while no attempt
 * is chosen: the engine's median time won or lost against the reference per
 * split, as one slim bar a split, won above the zero line and lost below, with
 * the quartiles as a whisker where the engine gives them. Nothing is computed
 * here beyond placing the engine's numbers.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Rect, RoundedRect } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { GestureDetector } from 'react-native-gesture-handler';

import { useMetricSystem } from '@/shared/app';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { formatDistance, formatDurationDelta } from '@/shared/format/format';
import { layoutSplitSummary, type DeltaFrame } from '@/features/routes/lib/deltaLayout';
import { deltaColour } from '@/features/routes/lib/deltaColour';
import { useChartColors, useChartGestures, useMeasuredWidth } from '@/shared/charts';
import { chartStyles, colors, darkColors, layout, spacing, stroke, typography } from '@/theme';
import { FfiReferenceSource, type FfiSplitSummary } from 'veloqrs';

const CHART_HEIGHT = 160;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;

export interface SectionDeltaSummaryChartProps {
  summary: FfiSplitSummary;
  referenceSource: FfiReferenceSource;
  /** Metres a split covers, the last one short. */
  splitStepM: number;
  sectionLengthM: number;
  isDark: boolean;
}

export function SectionDeltaSummaryChart({
  summary,
  referenceSource,
  splitStepM,
  sectionLengthM,
  isDark,
}: SectionDeltaSummaryChartProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { width: chartWidth, onLayout } = useMeasuredWidth();
  const palette = isDark ? darkColors : colors;
  const chartColors = useChartColors();

  const frame: DeltaFrame = useMemo(
    () => ({ width: chartWidth, height: CHART_HEIGHT, padding: CHART_PADDING }),
    [chartWidth]
  );
  const plot = useMemo(
    () => layoutSplitSummary(summary, splitStepM, sectionLengthM, frame),
    [summary, splitStepM, sectionLengthM, frame]
  );

  const vsRecord = referenceSource === FfiReferenceSource.Record;
  const splits = useMemo(
    () => Array.from(summary.medianSecs, (_, index) => index),
    [summary.medianSecs]
  );
  const splitRange = useCallback(
    (split: number) => ({
      from: formatDistance(split * splitStepM, isMetric),
      to: formatDistance(Math.min((split + 1) * splitStepM, sectionLengthM), isMetric),
    }),
    [splitStepM, sectionLengthM, isMetric]
  );
  const readSplit = useCallback(
    (split: number) => {
      const secs = summary.medianSecs[split];
      if (secs === undefined || !Number.isFinite(secs)) return null;
      return t(
        secs < 0
          ? vsRecord
            ? 'sections.deltaTypicalFasterThanRecord'
            : 'sections.deltaTypicalFasterThanReference'
          : vsRecord
            ? 'sections.deltaTypicalSlowerThanRecord'
            : 'sections.deltaTypicalSlowerThanReference',
        { ...splitRange(split), time: formatDurationDelta(Math.abs(secs)) }
      );
    },
    [summary.medianSecs, vsRecord, splitRange, t]
  );
  const describeSplit = useCallback(
    (split: number) => readSplit(split) ?? splitRange(split).from,
    [readSplit, splitRange]
  );
  const {
    gesture,
    selectedPoint: scrubSplit,
    syncXCoords,
    accessibilityProps,
  } = useChartGestures({
    data: splits,
    describePoint: describeSplit,
    accessibilityLabel: t('sections.viewAheadOrBehind'),
  });
  useEffect(() => {
    if (chartWidth > 0) syncXCoords(plot.splitCentres, (x) => x);
  }, [chartWidth, plot, syncXCoords]);
  const scrubBar =
    scrubSplit === null ? undefined : plot.bars.find((bar) => bar.index === scrubSplit);
  const scrubReading = scrubSplit === null ? null : readSplit(scrubSplit);

  const attempts = summary.laps.reduce((most, laps) => Math.max(most, laps), 0);
  const plotLeft = CHART_PADDING.left;
  const plotRight = chartWidth - CHART_PADDING.right;

  return (
    <View testID="section-delta-summary-chart" style={styles.container}>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.plot, chartStyles.plotDirection]}
          onLayout={onLayout}
          {...accessibilityProps}
        >
          {chartWidth > 0 && (
            <>
              <Canvas style={StyleSheet.absoluteFill}>
                <Rect
                  x={plotLeft}
                  y={plot.zeroY}
                  width={plotRight - plotLeft}
                  height={stroke.one}
                  color={chartColors.axis}
                />
                {plot.bars.map((bar) => (
                  <RoundedRect
                    key={bar.index}
                    x={bar.left}
                    y={bar.top}
                    width={bar.right - bar.left}
                    height={bar.bottom - bar.top}
                    r={Math.min(
                      layout.borderRadiusXs,
                      (bar.right - bar.left) / 2,
                      (bar.bottom - bar.top) / 2
                    )}
                    color={deltaColour(
                      summary.medianSecs[bar.index] ?? NaN,
                      plot.extentSecs,
                      isDark
                    )}
                  />
                ))}
                {plot.bars.map((bar) =>
                  bar.whisker === null ? null : (
                    <Rect
                      key={`whisker-${bar.index}`}
                      x={(bar.left + bar.right - stroke.one) / 2}
                      y={bar.whisker.top}
                      width={stroke.one}
                      height={bar.whisker.bottom - bar.whisker.top}
                      color={palette.textSecondary}
                    />
                  )
                )}
                {scrubBar !== undefined && (
                  <Rect
                    x={(scrubBar.left + scrubBar.right - stroke.one) / 2}
                    y={CHART_PADDING.top}
                    width={stroke.one}
                    height={CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom}
                    color={palette.textSecondary}
                  />
                )}
              </Canvas>
              <View
                style={styles.yAxisOverlay}
                pointerEvents="none"
                testID="section-delta-summary-y-axis"
              >
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    chartStyles.chartLabel,
                    styles.axisLabel,
                    isDark && chartStyles.chartLabelDark,
                    { top: CHART_PADDING.top },
                  ]}
                >
                  {`+${formatDurationDelta(plot.extentSecs)}`}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    chartStyles.chartLabel,
                    styles.axisLabel,
                    isDark && chartStyles.chartLabelDark,
                    { top: CHART_HEIGHT - CHART_PADDING.bottom - typography.caption.lineHeight },
                  ]}
                >
                  {`-${formatDurationDelta(plot.extentSecs)}`}
                </Text>
              </View>
            </>
          )}
        </View>
      </GestureDetector>
      <View
        style={[styles.edgeAxis, chartStyles.plotDirection]}
        testID="section-delta-summary-x-axis"
      >
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
        >
          {formatDistance(0, isMetric)}
        </Text>
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
        >
          {formatDistance(sectionLengthM, isMetric)}
        </Text>
      </View>
      {scrubReading !== null && (
        <Text
          testID="section-delta-summary-scrub"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[chartStyles.chartLabel, styles.caption, isDark && chartStyles.chartLabelDark]}
        >
          {scrubReading}
        </Text>
      )}
      <Text
        testID="section-delta-summary-caption"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[chartStyles.chartLabel, styles.caption, isDark && chartStyles.chartLabelDark]}
      >
        {t(vsRecord ? 'sections.deltaTypicalVsRecord' : 'sections.deltaTypicalVsReference', {
          distance: formatDistance(splitStepM, isMetric),
        })}
      </Text>
      <Text
        testID="section-delta-summary-attempts"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[chartStyles.chartLabel, styles.caption, isDark && chartStyles.chartLabelDark]}
      >
        {t('sections.deltaTypicalAttempts', { count: attempts })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    paddingBottom: spacing.xs,
  },
  plot: {
    height: CHART_HEIGHT,
  },
  yAxisOverlay: {
    ...StyleSheet.absoluteFill,
  },
  axisLabel: {
    position: 'absolute',
    left: CHART_PADDING.left + 2,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
  },
  caption: {
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
});
