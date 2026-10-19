/**
 * Delta plot of the engine's per-lap curves for one direction: seconds won or
 * lost against a named reference along the section, the reference as the flat
 * line and ahead of it drawn up. The selected lap (else the newest) is drawn in
 * full with its gap to the flat line filled cool where it is ahead and warm
 * where it is behind; the other laps are muted lines against the same
 * reference. Nothing is computed here beyond placing the engine's numbers.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Path, Rect } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { GestureDetector } from 'react-native-gesture-handler';

import { useMetricSystem } from '@/shared/app';
import { DenseText } from '@/shared/ui/DenseText';
import {
  formatDistance,
  formatDurationDelta,
  formatShortDateWithYear,
} from '@/shared/format/format';
import {
  deltasAgainst,
  layoutDelta,
  pickEmphasisedLap,
  resolveReference,
  scrubDeltaSecs,
  scrubStops,
  type DeltaFrame,
} from '@/features/routes/lib/deltaLayout';
import { deltaColour } from '@/features/routes/lib/deltaColour';
import { referenceNameKey, referencePhraseKey } from '@/features/routes/lib/deltaReference';
import {
  ChartSurface,
  LINE_CAP,
  LINE_JOIN,
  ScrubDot,
  Y_LABEL_BOX,
  YAxisLabels,
  areaWashOpacity,
  chartStroke,
  curveSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  useMeasuredWidth,
  type SummarySeries,
} from '@/shared/charts';
import { chartStyles, spacing, stroke } from '@/theme';
import type { FfiDirectionDeltas, FfiReferenceSource } from 'veloqrs';

const CHART_HEIGHT = 160;
const CHART_PADDING = { left: 4, right: 8, top: 12, bottom: 12 } as const;

export interface SectionDeltaChartProps {
  deltas: FfiDirectionDeltas;
  /** Metres between two points of a lap's curve. */
  gridStepM: number;
  sectionLengthM: number;
  isDark: boolean;
  highlightedActivityId?: string | undefined;
  /** The reference chosen in "Compare with". Absent, the chart opens on the engine's default. */
  reference?: FfiReferenceSource | undefined;
}

export function SectionDeltaChart({
  deltas,
  gridStepM,
  sectionLengthM,
  isDark,
  highlightedActivityId,
  reference: requestedReference,
}: SectionDeltaChartProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const chartColors = useChartColors();
  const { width: chartWidth, onLayout } = useMeasuredWidth();

  const reference = resolveReference(deltas, requestedReference);
  const shown = useMemo(() => deltasAgainst(deltas, reference), [deltas, reference]);
  const frame: DeltaFrame = useMemo(
    () => ({ width: chartWidth, height: CHART_HEIGHT, padding: CHART_PADDING }),
    [chartWidth]
  );
  const plot = useMemo(
    () => layoutDelta(shown, gridStepM, sectionLengthM, frame, highlightedActivityId),
    [shown, gridStepM, sectionLengthM, frame, highlightedActivityId]
  );
  const emphasisedLap = pickEmphasisedLap(shown.laps, highlightedActivityId);
  const referenceDate =
    shown.laps.find((lap) => lap.activityId === shown.referenceActivityId)?.activityDate ??
    (shown.previousRecord?.activityId === shown.referenceActivityId
      ? shown.previousRecord?.activityDate
      : undefined);

  const signed = useCallback(
    (secs: number) =>
      t(secs < 0 ? 'sections.deltaAhead' : 'sections.deltaBehind', {
        time: formatDurationDelta(Math.abs(secs)),
      }),
    [t]
  );
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
    accessibilityLabel: t('sections.viewAheadOrBehind'),
  });
  useEffect(() => {
    if (chartWidth > 0) syncXCoords(stops, (stop) => plot.xForDistance(stop.distanceM));
  }, [chartWidth, stops, plot, syncXCoords]);
  const scrubReading = scrub === null ? null : readStop(scrub);
  const scrubSecs = scrub === null ? undefined : scrubDeltaSecs(emphasisedLap, scrub.index);

  const reading = useMemo(() => {
    const series: SummarySeries = {
      name: t('sections.viewAheadOrBehind'),
      points: stops.map((stop) => ({
        label: formatDistance(stop.distanceM, isMetric),
        value: scrubDeltaSecs(emphasisedLap, stop.index),
      })),
      format: signed,
      lowerIsBetter: true,
    };
    return {
      summary: curveSummary(series, t),
      table: seriesTable(series.name, t('charts.column.distance'), [series]),
    };
  }, [stops, emphasisedLap, isMetric, signed, t]);

  const referenceName = t(referenceNameKey(reference));
  const referencePhrase = t(referencePhraseKey(reference));
  const legend =
    referenceDate !== undefined
      ? t('sections.deltaFlatLineDated', {
          reference: referencePhrase,
          date: formatShortDateWithYear(new Date(referenceDate * 1000)),
        })
      : t('sections.deltaFlatLine', { reference: referencePhrase });
  // The axis runs from ahead at the top to behind at the bottom. The gutter places a label by
  // value on an ascending domain, so each label sits at the value its row would hold there.
  const yTicks = useMemo(
    () => [
      { value: plot.extentSecs, label: signed(-plot.extentSecs) },
      { value: -plot.extentSecs, label: signed(plot.extentSecs) },
    ],
    [plot.extentSecs, signed]
  );
  const endSecs = emphasisedLap?.endDeltaSecs;
  const plotLeft = CHART_PADDING.left;
  const plotRight = chartWidth - CHART_PADDING.right;
  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];
  const washOpacity = areaWashOpacity(isDark);

  return (
    <View testID="section-delta-chart" style={styles.container}>
      <ChartSurface summary={reading.summary} table={reading.table} style={styles.surface}>
        <View style={styles.plotRow}>
          <YAxisLabels
            ticks={yTicks}
            domain={[-plot.extentSecs, plot.extentSecs]}
            padding={CHART_PADDING}
            testID="section-delta-y-axis"
          />
          <GestureDetector gesture={gesture}>
            <View style={styles.plot} onLayout={onLayout} {...accessibilityProps}>
              {chartWidth > 0 && (
                <>
                  <Canvas style={StyleSheet.absoluteFill}>
                    {plot.fill.ahead !== '' && (
                      <Path
                        path={plot.fill.ahead}
                        style="fill"
                        color={deltaColour(-plot.extentSecs, plot.extentSecs, isDark)}
                        opacity={washOpacity}
                      />
                    )}
                    {plot.fill.behind !== '' && (
                      <Path
                        path={plot.fill.behind}
                        style="fill"
                        color={deltaColour(plot.extentSecs, plot.extentSecs, isDark)}
                        opacity={washOpacity}
                      />
                    )}
                    <Rect
                      x={plotLeft}
                      y={plot.zeroY}
                      width={plotRight - plotLeft}
                      height={chartStroke.axis}
                      color={chartColors.axis}
                    />
                    {plot.laps
                      .filter((lap) => !lap.emphasised && lap.path !== '')
                      .map((lap) => (
                        <Path
                          key={`${lap.activityId}-${lap.startIndex}`}
                          path={lap.path}
                          style="stroke"
                          strokeWidth={stroke.hairline}
                          strokeJoin={LINE_JOIN}
                          color={chartColors.muted}
                        />
                      ))}
                    {plot.laps
                      .filter((lap) => lap.emphasised && lap.path !== '')
                      .map((lap) => (
                        <Path
                          key={`${lap.activityId}-${lap.startIndex}`}
                          path={lap.path}
                          style="stroke"
                          strokeWidth={chartStroke.series}
                          strokeJoin={LINE_JOIN}
                          strokeCap={LINE_CAP}
                          color={chartColors.ink}
                        />
                      ))}
                    {scrub !== null && (
                      <Rect
                        x={plot.xForDistance(scrub.distanceM)}
                        y={CHART_PADDING.top}
                        width={chartStroke.crosshair}
                        height={CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom}
                        color={chartColors.crosshair}
                      />
                    )}
                    <ScrubDot
                      at={
                        scrub !== null && scrubSecs !== undefined && Number.isFinite(scrubSecs)
                          ? { x: plot.xForDistance(scrub.distanceM), y: plot.yForSecs(scrubSecs) }
                          : null
                      }
                      color={deltaColour(scrubSecs ?? NaN, plot.extentSecs, isDark)}
                    />
                  </Canvas>
                </>
              )}
              {/* The flat line's name sits on it, which needs only the plot's height. */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <DenseText
                  testID="section-delta-reference-name"
                  style={[...labelStyle, styles.referenceName, { top: plot.zeroY - Y_LABEL_BOX }]}
                >
                  {referenceName}
                </DenseText>
              </View>
            </View>
          </GestureDetector>
        </View>
        <View style={[styles.edgeAxis, chartStyles.plotDirection]} testID="section-delta-x-axis">
          <DenseText style={labelStyle}>{formatDistance(0, isMetric)}</DenseText>
          <DenseText style={labelStyle}>{formatDistance(sectionLengthM, isMetric)}</DenseText>
        </View>
      </ChartSurface>
      {scrubReading !== null && (
        <DenseText testID="section-delta-scrub" style={[...labelStyle, styles.caption]}>
          {scrubReading}
        </DenseText>
      )}
      <DenseText testID="section-delta-caption" style={[...labelStyle, styles.caption]}>
        {legend}
      </DenseText>
      {endSecs !== undefined && Number.isFinite(endSecs) && (
        <DenseText testID="section-delta-end" style={[...labelStyle, styles.caption]}>
          {t(endSecs < 0 ? 'sections.deltaEndAhead' : 'sections.deltaEndBehind', {
            time: formatDurationDelta(Math.abs(endSecs)),
          })}
        </DenseText>
      )}
      {shown.missing.length > 0 && (
        <DenseText testID="section-delta-missing" style={[...labelStyle, styles.caption]}>
          {t('sections.deltaMissing', { attempts: shown.missing.length })}
        </DenseText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  surface: {
    flex: 0,
  },
  plotRow: {
    flexDirection: 'row',
  },
  plot: {
    flex: 1,
    height: CHART_HEIGHT,
  },
  referenceName: {
    position: 'absolute',
    right: CHART_PADDING.right,
  },
  edgeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  caption: {
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
});
