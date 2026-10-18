/**
 * Delta plot of the engine's per-lap curves for one direction: seconds won or
 * lost against the section's reference along the section, the reference as the
 * zero line and ahead of it below. Every lap is a faint line, the selected one
 * (else the newest) is drawn in full. Nothing is computed here beyond placing
 * the engine's numbers.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Path, Rect } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useMetricSystem } from '@/shared/app';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import {
  formatDistance,
  formatDurationDelta,
  formatShortDateWithYear,
} from '@/shared/format/format';
import {
  layoutDelta,
  pickEmphasisedLap,
  scrubDeltaSecs,
  scrubStops,
  type DeltaFrame,
} from '@/features/routes/lib/deltaLayout';
import { useChartGestures, useMeasuredWidth } from '@/shared/charts';
import { chartStyles, colors, darkColors, spacing, typography } from '@/theme';
import { FfiReferenceSource, type FfiDirectionDeltas } from 'veloqrs';

const CHART_HEIGHT = 160;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;
const ZERO_LINE_THICKNESS = 1;
const FAINT_STROKE = 1;
const FULL_STROKE = 2.5;
const FAINT_OPACITY = 0.25;
const SCRUB_THICKNESS = 1;

export interface SectionDeltaChartProps {
  deltas: FfiDirectionDeltas;
  /** Metres between two points of a lap's curve. */
  gridStepM: number;
  sectionLengthM: number;
  isDark: boolean;
  highlightedActivityId?: string | undefined;
}

export function SectionDeltaChart({
  deltas,
  gridStepM,
  sectionLengthM,
  isDark,
  highlightedActivityId,
}: SectionDeltaChartProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { width: chartWidth, onLayout } = useMeasuredWidth();
  const palette = isDark ? darkColors : colors;

  const frame: DeltaFrame = useMemo(
    () => ({ width: chartWidth, height: CHART_HEIGHT, padding: CHART_PADDING }),
    [chartWidth]
  );
  const plot = useMemo(
    () => layoutDelta(deltas, gridStepM, sectionLengthM, frame, highlightedActivityId),
    [deltas, gridStepM, sectionLengthM, frame, highlightedActivityId]
  );
  const emphasisedLap = pickEmphasisedLap(deltas.laps, highlightedActivityId);
  const referenceLap = deltas.laps.find((lap) => lap.activityId === deltas.referenceActivityId);

  const stops = useMemo(() => scrubStops(sectionLengthM, gridStepM), [sectionLengthM, gridStepM]);
  const readStop = useCallback(
    (stop: (typeof stops)[number]) => {
      const secs = scrubDeltaSecs(emphasisedLap, stop.index);
      return secs !== undefined && Number.isFinite(secs)
        ? t(secs < 0 ? 'sections.deltaReadoutAhead' : 'sections.deltaReadoutBehind', {
            distance: formatDistance(stop.distanceM, isMetric),
            time: formatDurationDelta(Math.abs(secs)),
          })
        : null;
    },
    [emphasisedLap, isMetric, t]
  );
  const describeStop = useCallback(
    (stop: (typeof stops)[number]) => readStop(stop) ?? formatDistance(stop.distanceM, isMetric),
    [readStop, isMetric]
  );
  const {
    gesture,
    selectedPoint: scrub,
    syncXCoords,
    accessibilityProps,
  } = useChartGestures({
    data: stops,
    describePoint: describeStop,
    accessibilityLabel: t('sections.plotDelta'),
  });
  useEffect(() => {
    if (chartWidth > 0) syncXCoords(stops, (stop) => plot.xForDistance(stop.distanceM));
  }, [chartWidth, stops, plot, syncXCoords]);
  const scrubReading = scrub === null ? null : readStop(scrub);

  const referenceLabel = t(
    deltas.referenceSource === FfiReferenceSource.Record
      ? 'sections.deltaVsRecord'
      : 'sections.deltaVsReference'
  );
  const caption = referenceLap
    ? `${referenceLabel} · ${formatShortDateWithYear(new Date(referenceLap.activityDate * 1000))}`
    : referenceLabel;
  const endSecs = emphasisedLap?.endDeltaSecs;
  const plotLeft = CHART_PADDING.left;
  const plotRight = chartWidth - CHART_PADDING.right;

  return (
    <View testID="section-delta-chart" style={[styles.container]}>
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
                  height={ZERO_LINE_THICKNESS}
                  color={palette.border}
                />
                {plot.laps
                  .filter((lap) => !lap.emphasised && lap.path !== '')
                  .map((lap) => (
                    <Path
                      key={`${lap.activityId}-${lap.startIndex}`}
                      path={lap.path}
                      style="stroke"
                      strokeWidth={FAINT_STROKE}
                      color={palette.actionPrimary}
                      opacity={FAINT_OPACITY}
                    />
                  ))}
                {plot.laps
                  .filter((lap) => lap.emphasised && lap.path !== '')
                  .map((lap) => (
                    <Path
                      key={`${lap.activityId}-${lap.startIndex}`}
                      path={lap.path}
                      style="stroke"
                      strokeWidth={FULL_STROKE}
                      strokeJoin="round"
                      color={palette.chartGreenMark}
                    />
                  ))}
                {scrub !== null && (
                  <Rect
                    x={plot.xForDistance(scrub.distanceM)}
                    y={CHART_PADDING.top}
                    width={SCRUB_THICKNESS}
                    height={CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom}
                    color={palette.textSecondary}
                  />
                )}
              </Canvas>
              <View style={styles.yAxisOverlay} pointerEvents="none" testID="section-delta-y-axis">
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    chartStyles.chartLabel,
                    isDark && chartStyles.chartLabelDark,
                    styles.yLabel,
                    { top: CHART_PADDING.top },
                  ]}
                >
                  {`+${formatDurationDelta(plot.extentSecs)}`}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    chartStyles.chartLabel,
                    isDark && chartStyles.chartLabelDark,
                    styles.yLabel,
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
      <View style={[styles.edgeAxis, chartStyles.plotDirection]} testID="section-delta-x-axis">
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
          testID="section-delta-scrub"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.textDark]}
        >
          {scrubReading}
        </Text>
      )}
      <Text
        testID="section-delta-caption"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.caption, isDark && styles.textDark]}
      >
        {caption}
      </Text>
      {endSecs !== undefined && Number.isFinite(endSecs) && (
        <Text
          testID="section-delta-end"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.textDark]}
        >
          {t(endSecs < 0 ? 'sections.deltaEndAhead' : 'sections.deltaEndBehind', {
            time: formatDurationDelta(Math.abs(endSecs)),
          })}
        </Text>
      )}
      {deltas.missing.length > 0 && (
        <Text
          testID="section-delta-missing"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.textDark]}
        >
          {t('sections.deltaMissing', { attempts: deltas.missing.length })}
        </Text>
      )}
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
  yLabel: {
    position: 'absolute',
    left: CHART_PADDING.left + spacing.xxs,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
  },
  caption: {
    textAlign: 'center',
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
