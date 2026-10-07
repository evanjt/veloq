/**
 * Delta plot of the engine's per-lap curves for one direction: seconds won or
 * lost against the section's reference along the section, the reference as the
 * zero line and ahead of it below. Every lap is a faint line, the selected one
 * (else the newest) is drawn in full. Nothing is computed here beyond placing
 * the engine's numbers.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Path, Rect } from '@shopify/react-native-skia';

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
  snapScrubIndex,
  type DeltaFrame,
} from '@/features/routes/lib/deltaLayout';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { FfiReferenceSource, type FfiDirectionDeltas } from 'veloqrs';

/** Horizontal room the chart leaves at the window edge, as the scatter does. */
const CHART_INSET = 32;
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
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - CHART_INSET;
  const palette = isDark ? darkColors : colors;
  const [scrubX, setScrubX] = useState<number | null>(null);

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

  const scrub = scrubX === null ? null : snapScrubIndex(scrubX, plot, gridStepM);
  const scrubSecs = scrub === null ? undefined : emphasisedLap?.deltaSecs[scrub.index];
  const scrubReading =
    scrub !== null && scrubSecs !== undefined && Number.isFinite(scrubSecs)
      ? t(scrubSecs < 0 ? 'sections.deltaReadoutAhead' : 'sections.deltaReadoutBehind', {
          distance: formatDistance(scrub.distanceM, isMetric),
          time: formatDurationDelta(Math.abs(scrubSecs)),
        })
      : null;

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

  const touchX = (event: { nativeEvent: { locationX: number } }) =>
    setScrubX(event.nativeEvent.locationX);

  return (
    <View testID="section-delta-chart" style={[styles.container, isDark && styles.containerDark]}>
      <View
        style={{ width: chartWidth, height: CHART_HEIGHT }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={touchX}
        onResponderMove={touchX}
        onResponderRelease={() => setScrubX(null)}
        onResponderTerminate={() => setScrubX(null)}
      >
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
                color={palette.primary}
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
        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.axisLabel, isDark && styles.axisLabelDark, { top: CHART_PADDING.top }]}
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
          testID="section-delta-scrub"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.axisLabelDark]}
        >
          {scrubReading}
        </Text>
      )}
      <Text
        testID="section-delta-caption"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.caption, isDark && styles.axisLabelDark]}
      >
        {caption}
      </Text>
      {endSecs !== undefined && Number.isFinite(endSecs) && (
        <Text
          testID="section-delta-end"
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.caption, isDark && styles.axisLabelDark]}
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
          style={[styles.caption, isDark && styles.axisLabelDark]}
        >
          {t('sections.deltaMissing', { attempts: deltas.missing.length })}
        </Text>
      )}
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
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  edgeLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
  },
  caption: {
    textAlign: 'center',
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
});
