/**
 * Delta plot of the typical attempt for one direction, shown while no attempt
 * is chosen: the engine's median time won or lost against the reference per
 * split, as one slim bar a split, lost above the zero line and won below, with
 * the quartiles as a whisker where the engine gives them. Nothing is computed
 * here beyond placing the engine's numbers.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Rect, RoundedRect } from '@shopify/react-native-skia';

import { useMetricSystem } from '@/shared/app';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { formatDistance, formatDurationDelta } from '@/shared/format/format';
import {
  layoutSplitSummary,
  splitAtDistance,
  type DeltaFrame,
} from '@/features/routes/lib/deltaLayout';
import { useMeasuredWidth } from '@/shared/charts';
import { colors, darkColors, layout, mapLayerColors, spacing, stroke, typography } from '@/theme';
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
  const [scrubX, setScrubX] = useState<number | null>(null);

  const frame: DeltaFrame = useMemo(
    () => ({ width: chartWidth, height: CHART_HEIGHT, padding: CHART_PADDING }),
    [chartWidth]
  );
  const plot = useMemo(
    () => layoutSplitSummary(summary, splitStepM, sectionLengthM, frame),
    [summary, splitStepM, sectionLengthM, frame]
  );

  const vsRecord = referenceSource === FfiReferenceSource.Record;
  const splitCount = summary.medianSecs.length;
  const scrubSplit =
    scrubX === null
      ? undefined
      : splitAtDistance(plot.distanceForX(scrubX), splitStepM, splitCount);
  const scrubSecs = scrubSplit === undefined ? undefined : summary.medianSecs[scrubSplit];
  const scrubBar = plot.bars.find((bar) => bar.index === scrubSplit);
  const scrubReading =
    scrubSplit !== undefined && scrubSecs !== undefined && Number.isFinite(scrubSecs)
      ? t(
          scrubSecs < 0
            ? vsRecord
              ? 'sections.deltaTypicalFasterThanRecord'
              : 'sections.deltaTypicalFasterThanReference'
            : vsRecord
              ? 'sections.deltaTypicalSlowerThanRecord'
              : 'sections.deltaTypicalSlowerThanReference',
          {
            from: formatDistance(scrubSplit * splitStepM, isMetric),
            to: formatDistance(Math.min((scrubSplit + 1) * splitStepM, sectionLengthM), isMetric),
            time: formatDurationDelta(Math.abs(scrubSecs)),
          }
        )
      : null;

  const attempts = summary.laps.reduce((most, laps) => Math.max(most, laps), 0);
  const plotLeft = CHART_PADDING.left;
  const plotRight = chartWidth - CHART_PADDING.right;

  const touchX = (event: { nativeEvent: { locationX: number } }) =>
    setScrubX(event.nativeEvent.locationX);

  return (
    <View testID="section-delta-summary-chart" style={styles.container}>
      <View
        style={styles.plot}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={touchX}
        onResponderMove={touchX}
        onResponderRelease={() => setScrubX(null)}
        onResponderTerminate={() => setScrubX(null)}
      >
        {chartWidth > 0 && (
          <>
            <Canvas style={StyleSheet.absoluteFill}>
              <Rect
                x={plotLeft}
                y={plot.zeroY}
                width={plotRight - plotLeft}
                height={stroke.one}
                color={palette.border}
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
                  color={bar.lost ? mapLayerColors.deltaLost : mapLayerColors.deltaWon}
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
            <View style={styles.yAxisOverlay} pointerEvents="none">
              <Text
                maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                style={[
                  styles.axisLabel,
                  isDark && styles.axisLabelDark,
                  { top: CHART_PADDING.top },
                ]}
              >
                {`+${formatDurationDelta(plot.extentSecs)}`}
              </Text>
              <Text
                maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                style={[
                  styles.axisLabel,
                  isDark && styles.axisLabelDark,
                  { top: CHART_HEIGHT - CHART_PADDING.bottom - 14 },
                ]}
              >
                {`-${formatDurationDelta(plot.extentSecs)}`}
              </Text>
            </View>
          </>
        )}
      </View>
      <View style={styles.edgeAxis}>
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.edgeLabel, isDark && styles.axisLabelDark]}
        >
          {formatDistance(0, isMetric)}
        </Text>
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.edgeLabel, isDark && styles.axisLabelDark]}
        >
          {formatDistance(sectionLengthM, isMetric)}
        </Text>
      </View>
      {scrubReading !== null && (
        <Text
          testID="section-delta-summary-scrub"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.axisLabelDark]}
        >
          {scrubReading}
        </Text>
      )}
      <Text
        testID="section-delta-summary-caption"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.caption, isDark && styles.axisLabelDark]}
      >
        {t(vsRecord ? 'sections.deltaTypicalVsRecord' : 'sections.deltaTypicalVsReference', {
          distance: formatDistance(splitStepM, isMetric),
        })}
      </Text>
      <Text
        testID="section-delta-summary-attempts"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.caption, isDark && styles.axisLabelDark]}
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
    ...typography.micro,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: darkColors.textSecondary,
  },
  edgeLabel: {
    ...typography.micro,
    color: colors.textSecondary,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
  },
  caption: {
    textAlign: 'center',
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
});
