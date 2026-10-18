/**
 * Histogram plot of the engine's attempt-time bins for one direction.
 * Fastest attempts are at the left. Bars, ticks and marks are placed from the
 * engine's bins alone; nothing is binned here. The count axis starts at zero,
 * each bar is capped and centred in its bin, the record's line is dashed and
 * this activity's is solid, so the two read apart without their colours, and
 * each line is keyed on its own row only while it is drawn.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GestureDetector } from 'react-native-gesture-handler';
import { DashPathEffect, Line, vec } from '@shopify/react-native-skia';

import { useMetricSystem } from '@/shared/app';
import { DenseText } from '@/shared/ui/DenseText';
import { formatDuration } from '@/shared/format/format';
import {
  binsContain,
  integerCountTicks,
  layoutHistogram,
} from '@/features/routes/lib/histogramLayout';
import { attemptBasis } from '@/features/routes/lib/attemptBasis';
import { formatSectionSpeed } from '@/features/routes/lib/sectionSpeedFormat';
import {
  ChartBar,
  ChartCanvas,
  ChartCrosshair,
  ChartMarkKey,
  ChartSurface,
  REFERENCE_DASH,
  YAxisLabels,
  Y_LABEL_BOX,
  chartStroke,
  partsSummary,
  partsTable,
  useChartColors,
  useChartGestures,
  type ChartMarkKeyKind,
} from '@/shared/charts';
import { chartStyles, spacing } from '@/theme';
import type { FfiAttemptHistogram } from 'veloqrs';
import type { ActivityType } from '@/types';

const CHART_HEIGHT = 120;
const X_STRIP = Y_LABEL_BOX;
/** Half a label line above the top tick and below the zero, so each label centres on its row. */
const PLOT_PADDING = {
  left: chartStroke.series,
  right: chartStroke.series,
  top: Y_LABEL_BOX / 2,
  bottom: Y_LABEL_BOX / 2 + X_STRIP,
} as const;
const X_DOMAIN: [number, number] = [0, 1];
const NO_SERIES = {} as Record<never, (bin: HistogramBin) => number>;
const NO_DATA: never[] = [];
const xOfNothing = () => 0;

interface HistogramBin {
  index: number;
  count: number;
  range: string;
}

export interface AttemptHistogramChartProps {
  histogram: FfiAttemptHistogram;
  activityType: ActivityType;
  isDark: boolean;
  /** Label the bin edges as durations, for a route, rather than as pace or speed. */
  useTimeAxis?: boolean | undefined;
  /** Time in seconds of the highlighted attempt, when it is in this direction. */
  highlightedTime?: number | null | undefined;
  /** Time in seconds of this direction's best. */
  recordTime?: number | null | undefined;
  /** The best is the direction's record, so its line is labelled PR rather than Best. */
  recordHeld?: boolean | undefined;
}

export function AttemptHistogramChart({
  histogram,
  activityType,
  isDark,
  useTimeAxis,
  highlightedTime,
  recordTime,
  recordHeld = false,
}: AttemptHistogramChartProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const chartColors = useChartColors();

  const edgeLabel = useCallback(
    (edge: number) => {
      const speed = histogram.edgeSpeeds?.[edge];
      if (!useTimeAxis && speed !== undefined) {
        return formatSectionSpeed(speed, activityType, isMetric);
      }
      return formatDuration(histogram.startSecs + edge * histogram.binWidthSecs);
    },
    [histogram, useTimeAxis, activityType, isMetric]
  );

  const edgeLabels = useMemo(() => {
    const edges = histogram.counts.length;
    return [0, Math.floor(edges / 2), edges].map(edgeLabel);
  }, [histogram.counts.length, edgeLabel]);

  const bins = useMemo<HistogramBin[]>(
    () =>
      histogram.counts.map((count, index) => ({
        index,
        count,
        range: `${edgeLabel(index)}–${edgeLabel(index + 1)}`,
      })),
    [histogram.counts, edgeLabel]
  );

  const ticks = useMemo(
    () =>
      integerCountTicks(Math.max(0, ...histogram.counts)).map((count, i) => ({
        value: count,
        label: String(count),
        testID: `attempt-histogram-y-axis-${i}`,
      })),
    [histogram.counts]
  );
  const yDomain = useMemo<[number, number]>(
    () => [0, Math.max(1, ...histogram.counts)],
    [histogram.counts]
  );
  const gridValues = useMemo(() => ticks.map((tick) => tick.value), [ticks]);

  const describeBin = useCallback(
    (bin: HistogramBin) =>
      `${bin.range}, ${t('sections.correlationAttempts', { count: bin.count })}`,
    [t]
  );

  const spoken = useMemo(() => {
    const title = t('sections.viewSpread');
    const basis = attemptBasis(activityType, !!useTimeAxis);
    const binHeader =
      basis === 'time'
        ? t('charts.column.time')
        : basis === 'speed'
          ? t('chartTypes.speed')
          : t('chartTypes.pace');
    return {
      summary: partsSummary(
        title,
        bins.map((bin) => ({
          label: bin.range,
          value: t('sections.correlationAttempts', { count: bin.count }),
        })),
        t
      ),
      table: partsTable(
        title,
        binHeader,
        t('charts.column.attempts'),
        bins.map((bin) => ({ label: bin.range, value: String(bin.count) }))
      ),
    };
  }, [bins, activityType, useTimeAxis, t]);

  const { gesture, crosshairStyle, syncBounds, syncXCoords, accessibilityProps, scrubIndex } =
    useChartGestures<HistogramBin>({
      data: bins,
      accessibilityLabel: t('sections.viewSpread'),
      describePoint: describeBin,
    });

  // Whether a line is drawn does not depend on the box, so its key row is
  // decided before the canvas has measured.
  const record = recordTime != null && binsContain(histogram, recordTime) ? recordTime : null;
  const highlight =
    highlightedTime != null && binsContain(histogram, highlightedTime) ? highlightedTime : null;

  const scrubbed = scrubIndex >= 0 ? bins[scrubIndex] : undefined;
  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];

  return (
    <View testID="attempt-histogram" style={styles.container}>
      <DenseText
        testID="attempt-histogram-readout"
        style={[chartStyles.chartLabelStrong, isDark && chartStyles.chartLabelStrongDark]}
      >
        {scrubbed ? describeBin(scrubbed) : ' '}
      </DenseText>
      <ChartSurface
        testID="attempt-histogram-plot"
        summary={spoken.summary}
        table={spoken.table}
        style={styles.plot}
      >
        <View style={styles.row}>
          <YAxisLabels
            ticks={ticks}
            domain={yDomain}
            padding={PLOT_PADDING}
            testID="attempt-histogram-y-axis"
          />
          <GestureDetector gesture={gesture}>
            <View
              style={chartStyles.chartWrapper}
              testID="attempt-histogram-scrub"
              {...accessibilityProps}
            >
              <ChartCanvas
                data={NO_DATA}
                x={xOfNothing}
                series={NO_SERIES}
                xDomain={X_DOMAIN}
                yDomain={yDomain}
                padding={PLOT_PADDING}
                gridValues={gridValues}
              >
                {({ bounds, width, height }) => {
                  const plot = layoutHistogram(histogram, {
                    width,
                    height,
                    padding: PLOT_PADDING,
                  });
                  syncBounds(bounds);
                  syncXCoords(plot.bars, (bar) => bar.centre);
                  const recordX = record !== null ? plot.xForTime(record) : null;
                  const highlightX = highlight !== null ? plot.xForTime(highlight) : null;
                  return (
                    <>
                      {plot.bars.map((bar, i) => (
                        <ChartBar
                          key={i}
                          x={bar.centre}
                          from={plot.baseline}
                          to={bar.y}
                          width={bar.width}
                          color={chartColors.series}
                        />
                      ))}
                      {recordX !== null ? (
                        <Line
                          p1={vec(recordX, bounds.top)}
                          p2={vec(recordX, bounds.bottom)}
                          strokeWidth={chartStroke.series}
                          color={chartColors.recordLine}
                        >
                          <DashPathEffect intervals={REFERENCE_DASH} />
                        </Line>
                      ) : null}
                      {highlightX !== null ? (
                        <Line
                          p1={vec(highlightX, bounds.top)}
                          p2={vec(highlightX, bounds.bottom)}
                          strokeWidth={chartStroke.series}
                          color={chartColors.ink}
                        />
                      ) : null}
                    </>
                  );
                }}
              </ChartCanvas>
              <ChartCrosshair style={crosshairStyle} />
              <View style={styles.edgeAxis} pointerEvents="none" testID="attempt-histogram-x-axis">
                {edgeLabels.map((label, i) => (
                  <DenseText key={i} style={labelStyle}>
                    {label}
                  </DenseText>
                ))}
              </View>
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>
      {record !== null || highlight !== null ? (
        <View style={styles.key} testID="attempt-histogram-key">
          {highlight !== null ? (
            <KeyRow
              testID="attempt-histogram-highlight-key"
              mark="line"
              color={chartColors.ink}
              label={t('sections.legendThisActivity')}
              isDark={isDark}
            />
          ) : null}
          {record !== null ? (
            <KeyRow
              testID="attempt-histogram-record-key"
              mark="dashedLine"
              color={chartColors.recordLine}
              label={recordHeld ? t('sections.legendPr') : t('sections.best')}
              isDark={isDark}
            />
          ) : null}
        </View>
      ) : null}
      <DenseText testID="attempt-histogram-caption" style={[labelStyle, styles.caption]}>
        {t('sections.histogramBinned', { attempts: histogram.binned })}
      </DenseText>
      {histogram.unbinnedOutsideBand > 0 && (
        <DenseText testID="attempt-histogram-outside-band" style={[labelStyle, styles.caption]}>
          {t('sections.histogramOutsideBand', { attempts: histogram.unbinnedOutsideBand })}
        </DenseText>
      )}
    </View>
  );
}

/** One line's key: its mark drawn as the plot draws it, then its name. */
function KeyRow({
  mark,
  color,
  label,
  isDark,
  testID,
}: {
  mark: ChartMarkKeyKind;
  color: string;
  label: string;
  isDark: boolean;
  testID: string;
}) {
  return (
    <View style={styles.keyRow} testID={testID}>
      <ChartMarkKey mark={mark} color={color} testID={`${testID}-mark`} />
      <DenseText style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>
        {label}
      </DenseText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    paddingBottom: spacing.xs,
  },
  plot: {
    flex: 0,
    height: CHART_HEIGHT,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  edgeAxis: {
    position: 'absolute',
    left: PLOT_PADDING.left,
    right: PLOT_PADDING.right,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  key: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  caption: {
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
});
