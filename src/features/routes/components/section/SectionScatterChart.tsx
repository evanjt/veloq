/**
 * The attempt scatter: one direction at a time on the engine's focus range,
 * with its trend and spread band, the record's progression as a gold
 * staircase, and each attempt drawn with the marks `scatterMarks` gives it.
 * The reticle is this activity, a gold ring the record, a triangle at the edge
 * an attempt past the range, and a focus ring the selection.
 */

import { useMetricSystem } from '@/shared/app';
import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { Path, Skia } from '@shopify/react-native-skia';
import {
  ChartCanvas,
  ChartCrosshair,
  ChartDot,
  ChartShowDataButton,
  ChartSurface,
  EdgeTriangleMark,
  HollowDot,
  RETICLE_REACH,
  RecordRing,
  RecordStaircase,
  ReticleMark,
  SelectionRing,
  YAxisLabels,
  areaWashOpacity,
  bandSvgPath,
  chartStroke,
  polylineSvgPath,
  seriesSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  useMeasuredWidth,
  type SummarySeries,
} from '@/shared/charts';
import { GestureDetector } from 'react-native-gesture-handler';
import { formatAxisDate, formatDuration, formatShortDate } from '@/shared/format/format';
import { formatSectionSpeed } from '@/features/routes/lib/sectionSpeedFormat';
import { attemptBasis } from '@/features/routes/lib/attemptBasis';
import { directionColour } from '@/features/routes/lib/directionColour';
import {
  splitAndPositionChartData,
  placeEngineTrend,
  nearestScatterPointIndex,
  resolveChartDirection,
  type ChartDirection,
  type ScatterChartPoint,
} from '@/features/routes/lib/scatterData';
import {
  TAP_REACH_PX,
  clampToRange,
  placeRecordStaircase,
  scatterMarkFor,
  scatterRange,
  scatterStanding,
  scatterStandingText,
  type ScatterMark,
} from '@/features/routes/lib/scatterMarks';
import { computeTimeAxisLabels, axisLabelsNeedDay } from '@/features/stats';
import { chartStyles, colors, darkColors, iconSize, opacity, spacing, typography } from '@/theme';
import type { FfiRecordProgressions, FfiScatterFocus, FfiSectionTrendCurves } from 'veloqrs';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { StatsRow } from './StatsRow';
import { Icon } from '@/shared/ui/Icon';

const CHART_HEIGHT = 220;
const X_STRIP = typography.caption.lineHeight;
/** Every mark round a point reaches as far as the reticle, so the plot is inset by it. */
const PLOT_PADDING = {
  left: RETICLE_REACH,
  right: RETICLE_REACH,
  top: RETICLE_REACH,
  bottom: RETICLE_REACH + X_STRIP,
} as const;
const X_DOMAIN: [number, number] = [0, 1];
const NO_SERIES = {} as Record<never, (p: ScatterChartPoint) => number>;
const NO_PROGRESSION: FfiRecordProgressions = { forward: [], reverse: [] };
const NO_FOCUS: FfiScatterFocus = {};
const xOf = (p: { x: number }) => p.x;

export interface SectionScatterChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  /**
   * Every activity's time stream is read, so the engine's best point is the
   * record. Until then the point draws no record mark. Absent means settled.
   */
  recordsSettled?: boolean | undefined;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  /** This activity, the one the screen was opened from, which carries the reticle. */
  highlightedActivityId?: string | undefined;
  /** When true, Y-axis shows time (inverted: shorter = higher) instead of speed */
  useTimeAxis?: boolean | undefined;
  /** The engine's trend curves for the counted attempts. */
  trendCurves: FfiSectionTrendCurves;
  /**
   * The engine's range per direction, with the attempts past it counted. A
   * read that carries none draws every attempt on the axis.
   */
  scatterFocus?: FfiScatterFocus | undefined;
  /** The engine's record progression per direction, drawn as the staircase. */
  recordProgression?: FfiRecordProgressions | undefined;
  /**
   * The direction shown, which the panel owns. Absent, the chart opens on this
   * activity's direction, else the one with attempts.
   */
  selectedDirection?: ChartDirection | undefined;
  /** The point the panel's card describes, which carries the focus ring. */
  selectedPointId?: string | undefined;
  /** Called with the point a tap or a scrub lands on. */
  onSelectPoint?: ((point: ScatterChartPoint) => void) | undefined;
  /** Drawn at the start of the row that holds Show data, such as the excluded attempts link. */
  showDataRowStart?: React.ReactNode;
}

interface PlacedPoint {
  point: ScatterChartPoint;
  mark: ScatterMark;
  x: number;
  y: number;
}

export function SectionScatterChart({
  chartData,
  activityType,
  isDark,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  recordsSettled = true,
  forwardStats,
  reverseStats,
  highlightedActivityId,
  useTimeAxis,
  trendCurves,
  scatterFocus = NO_FOCUS,
  recordProgression = NO_PROGRESSION,
  selectedDirection: controlledDirection,
  selectedPointId,
  onSelectPoint,
  showDataRowStart,
}: SectionScatterChartProps) {
  const basis = attemptBasis(activityType, !!useTimeAxis);
  const axis = useTimeAxis ? 'time' : 'speed';
  const chartColors = useChartColors();
  const { t } = useTranslation();

  const isMetric = useMetricSystem();
  const { width: plotWidth, onLayout: onPlotLayout } = useMeasuredWidth();

  const formatValue = useCallback(
    (value: number) =>
      useTimeAxis ? formatDuration(value) : formatSectionSpeed(value, activityType, isMetric),
    [useTimeAxis, activityType, isMetric]
  );

  const { forwardPoints, reversePoints, allPoints, drawn } = useMemo(
    () => splitAndPositionChartData(chartData),
    [chartData]
  );
  const originDirection =
    allPoints.find((point) => point.activityId === highlightedActivityId)?.direction === 'reverse'
      ? 'reverse'
      : 'forward';
  const selectedDirection =
    controlledDirection ??
    resolveChartDirection(null, originDirection, drawn.forward, drawn.reverse);
  const selectedColour = directionColour(selectedDirection, isDark);
  const drawnPoints = useMemo(
    () =>
      allPoints.filter(
        (point) => (point.direction === 'reverse' ? 'reverse' : 'forward') === selectedDirection
      ),
    [allPoints, selectedDirection]
  );

  /** The value each point is drawn at, and the one a tap is resolved against. */
  const yOf = useCallback(
    (p: PerformanceDataPoint) => (useTimeAxis ? (p.sectionTime ?? NaN) : p.speed),
    [useTimeAxis]
  );

  const focus = scatterFocus[selectedDirection];
  const range = useMemo(
    () => scatterRange(focus, drawnPoints.map(yOf)) ?? ([0, 1] as [number, number]),
    [focus, drawnPoints, yOf]
  );
  // Faster is up: speed rises up the axis, time falls.
  const yDomain = useMemo<[number, number]>(
    () => (useTimeAxis ? [range[1], range[0]] : [range[0], range[1]]),
    [range, useTimeAxis]
  );
  const yTicks = useMemo(
    () =>
      [yDomain[1], (yDomain[0] + yDomain[1]) / 2, yDomain[0]].map((value, i) => ({
        value,
        label: formatValue(value),
        testID: `section-scatter-y-axis-${i}`,
      })),
    [yDomain, formatValue]
  );
  const gridValues = useMemo(() => yTicks.map((tick) => tick.value), [yTicks]);

  const selectedTrend = useMemo(
    () =>
      placeEngineTrend(
        selectedDirection === 'reverse'
          ? useTimeAxis
            ? trendCurves.reverseTime
            : trendCurves.reverseSpeed
          : useTimeAxis
            ? trendCurves.forwardTime
            : trendCurves.forwardSpeed,
        allPoints
      ),
    [trendCurves, allPoints, useTimeAxis, selectedDirection]
  );
  const staircase = useMemo(() => {
    const first = allPoints.at(0);
    const last = allPoints.at(-1);
    return placeRecordStaircase(
      recordsSettled ? recordProgression[selectedDirection] : [],
      first && last ? { first: first.date, last: last.date } : null,
      axis,
      range
    );
  }, [recordProgression, selectedDirection, allPoints, axis, range, recordsSettled]);

  const timeAxisLabels = useMemo(() => computeTimeAxisLabels(allPoints), [allPoints]);
  const needsDayLabel = useMemo(() => axisLabelsNeedDay(timeAxisLabels), [timeAxisLabels]);

  const selectedPoint = drawnPoints.find((point) => point.id === selectedPointId);
  const markContext = useMemo(
    () => ({
      highlightedActivityId,
      selected: selectedPoint
        ? { id: selectedPoint.id, activityId: selectedPoint.activityId }
        : null,
      recordsSettled,
    }),
    [highlightedActivityId, selectedPoint, recordsSettled]
  );
  const marks = useMemo(
    () => drawnPoints.map((point) => scatterMarkFor(point, markContext)),
    [drawnPoints, markContext]
  );

  const highlighted = drawnPoints.find((p) => p.activityId === highlightedActivityId);
  const standingText = highlighted
    ? scatterStandingText(
        recordsSettled
          ? scatterStanding(highlighted, recordProgression[selectedDirection], axis)
          : null,
        highlighted,
        axis,
        activityType,
        isMetric,
        t
      )
    : null;

  const spoken = useMemo(() => {
    const title = t('sections.performanceOverTime');
    const series: SummarySeries = {
      name: title,
      points: drawnPoints
        .filter((p) => p.isExcluded !== true)
        .map((p) => ({ label: formatShortDate(p.date), key: p.id, value: yOf(p) })),
      format: formatValue,
      lowerIsBetter: !!useTimeAxis,
    };
    return {
      summary: seriesSummary(series, t),
      table: seriesTable(title, t('charts.column.date'), [series]),
    };
  }, [drawnPoints, yOf, formatValue, useTimeAxis, t]);

  const handlePointPress = useCallback(
    (point: ScatterChartPoint) => onSelectPoint?.(point),
    [onSelectPoint]
  );

  const contentWidth = plotWidth - PLOT_PADDING.left - PLOT_PADDING.right;
  const contentHeight = CHART_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;

  // A point past the range is drawn at the edge, so a tap reaches it there.
  const tapPoints = useMemo(
    () => drawnPoints.map((p) => ({ x: p.x, y: clampToRange(yOf(p), range) })),
    [drawnPoints, yOf, range]
  );

  const resolveTapIndex = useCallback(
    (x: number, y: number) =>
      nearestScatterPointIndex(
        tapPoints,
        {
          x: (x - PLOT_PADDING.left) / contentWidth,
          y: (y - PLOT_PADDING.top) / contentHeight,
        },
        yDomain,
        { width: contentWidth, height: contentHeight, radius: TAP_REACH_PX }
      ),
    [tapPoints, contentWidth, contentHeight, yDomain]
  );

  const describePoint = useCallback(
    (point: ScatterChartPoint) => `${formatShortDate(point.date)}, ${formatValue(yOf(point))}`,
    [formatValue, yOf]
  );

  const { gesture, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<ScatterChartPoint>({
      data: drawnPoints,
      accessibilityLabel: t('sections.performanceOverTime'),
      crosshairMode: 'finger',
      onSelect: handlePointPress,
      resolveTapIndex,
      describePoint,
    });

  // Trend and band paths are pixels, so they only move when the box or the
  // domain does, never on a scrub tick.
  const trendPaths = useMemo(() => {
    if (plotWidth <= 0 || !selectedTrend || selectedTrend.length < 2) {
      return { line: null, band: null };
    }
    const xFor = (value: number) => PLOT_PADDING.left + value * contentWidth;
    const yFor = (value: number) => {
      const along = (value - yDomain[0]) / (yDomain[1] - yDomain[0] || 1);
      return PLOT_PADDING.top + (1 - along) * contentHeight;
    };
    const held = (value: number) => yFor(clampToRange(value, range));
    return {
      line: Skia.Path.MakeFromSVGString(
        polylineSvgPath(selectedTrend.map((p) => ({ x: xFor(p.x), y: held(p.y) })))
      ),
      band: Skia.Path.MakeFromSVGString(
        bandSvgPath(
          selectedTrend.map((p) => ({ x: xFor(p.x), y: held(p.upper) })),
          selectedTrend.map((p) => ({ x: xFor(p.x), y: held(p.lower) }))
        )
      ),
    };
  }, [selectedTrend, plotWidth, contentWidth, contentHeight, yDomain, range]);

  if (chartData.length < 1) return null;

  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];
  const slowCount = focus?.slowCount ?? 0;
  const fastCount = focus?.fastCount ?? 0;

  return (
    <View style={styles.container}>
      {selectedDirection === 'forward' && forwardPoints.length > 0 && (
        <StatsRow
          direction="forward"
          stats={forwardStats}
          bestRecord={bestForwardRecord}
          bestIsRecord={bestForwardIsRecord}
          pointCount={forwardPoints.length}
          basis={basis}
          isDark={isDark}
        />
      )}

      <ChartSurface
        testID="section-scatter-chart"
        summary={spoken.summary}
        table={spoken.table}
        style={styles.plot}
        showDataButton={false}
      >
        <View style={styles.row}>
          <YAxisLabels
            ticks={yTicks}
            domain={yDomain}
            padding={PLOT_PADDING}
            testID="section-scatter-y-axis"
          />
          <GestureDetector gesture={gesture}>
            <View style={chartStyles.chartWrapper} onLayout={onPlotLayout} {...accessibilityProps}>
              <ChartCanvas
                data={drawnPoints}
                x={xOf}
                series={NO_SERIES}
                xDomain={X_DOMAIN}
                yDomain={yDomain}
                padding={PLOT_PADDING}
                gridValues={gridValues}
              >
                {({ bounds, xFor, yFor }) => {
                  syncBounds(bounds);
                  syncXCoords(drawnPoints, (p) => xFor(p.x));
                  const placed: PlacedPoint[] = [];
                  drawnPoints.forEach((point, i) => {
                    const value = yOf(point);
                    const mark = marks[i];
                    if (!mark || !Number.isFinite(value)) return;
                    placed.push({
                      point,
                      mark,
                      x: xFor(point.x),
                      y: yFor(clampToRange(value, range)),
                    });
                  });
                  const carried = staircase.carriedIn;
                  return (
                    <>
                      {trendPaths.band ? (
                        <Path
                          path={trendPaths.band}
                          color={selectedColour}
                          style="fill"
                          opacity={areaWashOpacity(isDark)}
                        />
                      ) : null}
                      {trendPaths.line ? (
                        <Path
                          path={trendPaths.line}
                          color={selectedColour}
                          style="stroke"
                          strokeWidth={chartStroke.series}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      ) : null}
                      {staircase.steps.length > 0 || carried != null ? (
                        <RecordStaircase
                          steps={staircase.steps.map((s) => ({ x: xFor(s.x), y: yFor(s.value) }))}
                          carriedIn={
                            carried != null ? { x: bounds.left, y: yFor(carried) } : undefined
                          }
                          rightEdge={bounds.right}
                        />
                      ) : null}
                      {placed.map(({ point, mark, x, y }) => (
                        <PointMark
                          key={`${point.activityId}-${point.id}`}
                          mark={mark}
                          x={x}
                          y={y}
                          colour={selectedColour}
                          mutedColour={chartColors.muted}
                        />
                      ))}
                      {/* The record, this activity and the selection sit above every dot. */}
                      {placed.map(({ point, mark, x, y }) => (
                        <React.Fragment key={`marks-${point.activityId}-${point.id}`}>
                          {mark.record ? <RecordRing x={x} y={y} /> : null}
                          {mark.thisActivity ? <ReticleMark x={x} y={y} /> : null}
                          {mark.selected ? <SelectionRing x={x} y={y} /> : null}
                        </React.Fragment>
                      ))}
                    </>
                  );
                }}
              </ChartCanvas>

              <ChartCrosshair style={crosshairStyle} />

              {standingText && highlighted && plotWidth > 0 ? (
                <StandingLabel
                  text={standingText}
                  x={PLOT_PADDING.left + highlighted.x * contentWidth}
                  y={
                    PLOT_PADDING.top +
                    (1 -
                      (clampToRange(yOf(highlighted), range) - yDomain[0]) /
                        (yDomain[1] - yDomain[0] || 1)) *
                      contentHeight
                  }
                  plotWidth={plotWidth}
                  isDark={isDark}
                />
              ) : null}

              {timeAxisLabels.length > 0 ? (
                <View style={styles.timeAxis} pointerEvents="none">
                  {timeAxisLabels.map((date, idx) => (
                    <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} key={idx} style={labelStyle}>
                      {formatAxisDate(date, needsDayLabel)}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>
      <View style={styles.showDataRow}>
        <View style={styles.showDataRowStart}>{showDataRowStart}</View>
        <ChartShowDataButton table={spoken.table} testID="section-scatter-chart" />
      </View>

      {fastCount > 0 || slowCount > 0 ? (
        <View style={styles.offScaleRow} testID="section-scatter-off-scale">
          {fastCount > 0 ? (
            <OffScaleCount
              pointing="up"
              isDark={isDark}
              label={t('sections.scatterOffScale', { count: fastCount })}
              spoken={t('sections.scatterOffScaleFaster', { count: fastCount })}
            />
          ) : null}
          {slowCount > 0 ? (
            <OffScaleCount
              pointing="down"
              isDark={isDark}
              label={t('sections.scatterOffScale', { count: slowCount })}
              spoken={t('sections.scatterOffScaleSlower', { count: slowCount })}
            />
          ) : null}
        </View>
      ) : null}

      {selectedDirection === 'reverse' && reversePoints.length > 0 && (
        <StatsRow
          direction="reverse"
          stats={reverseStats}
          bestRecord={bestReverseRecord}
          bestIsRecord={bestReverseIsRecord}
          pointCount={reversePoints.length}
          basis={basis}
          isDark={isDark}
        />
      )}
    </View>
  );
}

/** The dot, dimmed dot, hollow ring or edge triangle one point is drawn as. */
function PointMark({
  mark,
  x,
  y,
  colour,
  mutedColour,
}: {
  mark: ScatterMark;
  x: number;
  y: number;
  colour: string;
  mutedColour: string;
}) {
  switch (mark.kind) {
    case 'excluded':
      return <ChartDot x={x} y={y} color={mutedColour} opacity={opacity.dim} />;
    case 'outsideBand':
      return <HollowDot x={x} y={y} color={colour} />;
    case 'offScaleTop':
      return <EdgeTriangleMark x={x} y={y} color={colour} pointing="up" />;
    case 'offScaleBottom':
      return <EdgeTriangleMark x={x} y={y} color={colour} pointing="down" />;
    default:
      return <ChartDot x={x} y={y} color={colour} />;
  }
}

/** This activity's standing, beside its reticle, on whichever side has room. */
function StandingLabel({
  text,
  x,
  y,
  plotWidth,
  isDark,
}: {
  text: string;
  x: number;
  y: number;
  plotWidth: number;
  isDark: boolean;
}) {
  const leftHalf = x < plotWidth / 2;
  const top = y - RETICLE_REACH - typography.caption.lineHeight;
  return (
    <Text
      testID="section-scatter-standing"
      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
      pointerEvents="none"
      style={[
        chartStyles.chartLabel,
        isDark && chartStyles.chartLabelDark,
        styles.standing,
        { top: Math.max(0, top) },
        leftHalf ? { left: x + RETICLE_REACH } : { right: plotWidth - x + RETICLE_REACH },
      ]}
    >
      {text}
    </Text>
  );
}

/** How many attempts lie past one end of the range, with an arrow pointing to that end. */
function OffScaleCount({
  pointing,
  isDark,
  label,
  spoken,
}: {
  pointing: 'up' | 'down';
  isDark: boolean;
  label: string;
  spoken: string;
}) {
  const ink = isDark ? darkColors.textSecondary : colors.textSecondary;
  return (
    <View style={styles.offScaleItem} accessible accessibilityLabel={spoken}>
      <Text
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
      >
        {label}
      </Text>
      <Icon name={pointing === 'up' ? 'arrow-up' : 'arrow-down'} size={iconSize.xs} color={ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  plot: {
    height: CHART_HEIGHT,
  },
  showDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  showDataRowStart: {
    flex: 1,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  timeAxis: {
    position: 'absolute',
    left: PLOT_PADDING.left,
    right: PLOT_PADDING.right,
    bottom: 0,
    height: X_STRIP,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  standing: {
    position: 'absolute',
  },
  offScaleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  offScaleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
});
