import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path,
  Rect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { chartStreamColour, chartStyles, opacity, spacing, stroke, typography } from '@/theme';
import {
  chartLaneName,
  type ChartConfig,
  type ChartTypeId,
} from '@/features/activity/lib/chartConfig';
import type { ActivityStreams as Streams, ActivityInterval, ActivityType } from '@/types';
import { ChartErrorBoundary, EmptyState } from '@/shared/ui';
import { DENSE_TEXT_SCALE, DenseText, denseExtent } from '@/shared/ui/DenseText';
import {
  ChartCanvas,
  ChartCrosshair,
  chartStroke,
  ChartSurface,
  CurveArea,
  curveAreaSvg,
  CurveLine,
  dataExtent,
  DOT_RADIUS,
  lanesSummary,
  REFERENCE_DASH,
  ScrubDot,
  seriesTable,
  useChartColors,
  useChartGestures,
  useMeasuredWidth,
  xForValue,
  type ChartFrame,
  type Domain,
  type ProjectedPoint,
  type SummarySeries,
} from '@/shared/charts';
import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  formatScrubValue,
  laneStack,
  LANE_AXIS_HEIGHT,
  LANE_TITLE_HEIGHT,
  resolveBandColour,
  seriesAverage,
  seriesUnit,
  type ChartMetricValue,
  type EmptyPlotCause,
  type IntervalBand,
  type SeriesInfo,
} from '@/features/stats';
import { ChartXAxisLabel, type ChartXAxisLabelHandle } from './ChartXAxisLabel';
import { ABSENT } from '@/shared/format/absent';
import { formatDecimal } from '@/shared/format';
import { formatDuration } from '@/shared/format/format';

export type { ChartMetricValue };

interface ActivityStreamsProps {
  streams: Streams;
  elevationGain: number | null | undefined;
  selectedCharts: ChartTypeId[];
  chartConfigs: Record<ChartTypeId, ChartConfig>;
  /**
   * The height the lanes share, as the full screen view gives it. Absent, each
   * lane takes the lane height and the stack grows, since the page scrolls.
   */
  height?: number | undefined;
  onPointSelect?: ((index: number | null) => void) | undefined;
  onInteractionChange?: ((isInteracting: boolean) => void) | undefined;
  /** X-axis mode: 'distance' (default) or 'time' */
  xAxisMode?: 'distance' | 'time' | undefined;
  /** Interval data - when provided, every lane draws a band behind each interval */
  intervals?: ActivityInterval[] | undefined;
  /** Activity type - needed for zone color selection (power vs HR) */
  activityType?: ActivityType | undefined;
  /** Called with per-series values when scrubbing or averages when idle */
  onMetricsChange?: ((metrics: ChartMetricValue[], isScrubbing: boolean) => void) | undefined;
}

type Datum = Record<string, number>;
type Accessor = Record<string, (d: Datum) => number>;

/** The plot keeps a dot's radius and ring clear of every edge, so a scrubbed extreme is whole. */
const PLOT_INSET = DOT_RADIUS + chartStroke.ring;
const PLOT_PADDING = {
  left: PLOT_INSET,
  right: PLOT_INSET,
  top: PLOT_INSET,
  bottom: PLOT_INSET,
};
/**
 * The gutter left of every lane holds its highest and lowest value. It is one
 * width for every lane, so all the lanes share one x and one scrub line runs
 * through them; five figures such as "12:34" or "1,234" fit at the text cap.
 */
const GUTTER = denseExtent(typography.caption.fontSize, 3) + spacing.xs;

const xOf = (d: Datum) => d.x;

const EMPTY_CAUSE_KEYS = {
  noDistance: 'activity.chartNoDistance',
  noSamples: 'activity.chartNoSamples',
  noMetrics: 'activity.chartNoMetrics',
} as const satisfies Record<EmptyPlotCause, string>;

/** A lane's title: the stream's full name, and its unit where it has one. */
function laneTitle(name: string, unit: string): string {
  return unit ? `${name} (${unit})` : name;
}

/**
 * An activity's recorded streams, one lane per stream on a shared distance or
 * time axis. Each lane is drawn at its own extent in its own unit, titled with
 * both, with its highest and lowest value in a gutter beside it, so no two
 * streams share a scale. Elevation and temperature are grey context areas,
 * grade fills either side of zero, and every other stream is a line in its
 * own colour with its average dashed across it. One scrub line runs through
 * every lane with a dot on each.
 */
export const ActivityStreams = React.memo(function ActivityStreams({
  streams,
  elevationGain,
  selectedCharts,
  chartConfigs,
  height,
  onPointSelect,
  onInteractionChange,
  xAxisMode = 'distance',
  intervals,
  activityType,
  onMetricsChange,
}: ActivityStreamsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const chartColors = useChartColors();
  const { fontScale } = useWindowDimensions();

  // The scrub position lives in the axis label that draws it, so a scrub tick
  // re-renders the label rather than every lane's paths.
  const xAxisLabel = useRef<ChartXAxisLabelHandle>(null);

  // The lanes span the box less the gutter, so that width in layout pixels is
  // the number of buckets the streams are thinned to.
  const { width, onLayout } = useMeasuredWidth();
  const plotRight = Math.max(0, width - GUTTER);
  const buckets = Math.max(1, Math.round(plotRight - 2 * PLOT_INSET));

  const { chartData, seriesInfo, indexMap, maxX, emptyCause } = useMemo(
    () => buildChartData(streams, selectedCharts, chartConfigs, isMetric, xAxisMode, buckets),
    [streams, selectedCharts, chartConfigs, isMetric, xAxisMode, buckets]
  );

  const xDomain = useMemo<Domain>(() => dataExtent(chartData, xOf), [chartData]);

  // One accessor map per lane, stable across a scrub so no lane re-projects.
  const accessors = useMemo(
    () =>
      Object.fromEntries(
        seriesInfo.map((s) => [s.id, { [s.id]: (d: Datum) => d[s.id] } as Accessor])
      ),
    [seriesInfo]
  );

  // The title as the system text size draws it, which the shared height pays for.
  const titleHeight = Math.ceil(LANE_TITLE_HEIGHT * Math.min(fontScale, DENSE_TEXT_SCALE));
  const stack = laneStack(seriesInfo.length, height, titleHeight);

  // The idle readout: every available stream's average, or the climb's gain.
  const allAverages = useMemo(
    () => computeAllAverages(chartConfigs, streams, isMetric, elevationGain),
    [chartConfigs, streams, isMetric, elevationGain]
  );

  useEffect(() => {
    if (allAverages.length > 0) onMetricsChange?.(allAverages, false);
  }, [allAverages, onMetricsChange]);

  const xUnit = xAxisMode === 'time' ? '' : isMetric ? 'km' : 'mi';
  const xLabel = useCallback(
    (x: number) => (xAxisMode === 'time' ? formatDuration(x) : `${formatDecimal(x, 2)} ${xUnit}`),
    [xAxisMode, xUnit]
  );

  const handleSelect = useCallback(
    (point: Datum, idx: number) => {
      const sample = indexMap[idx];
      if (sample === undefined) return;
      xAxisLabel.current?.setScrub(point.x ?? 0);
      const scrubbed: ChartMetricValue[] = seriesInfo.map((s) => ({
        id: s.id,
        label: s.config.label,
        value: formatScrubValue(s.config, s.rawData[sample], isMetric),
        unit: seriesUnit(s.config, isMetric),
        // The widest value the chip may show, so it keeps its width while scrubbing.
        maxValueWidth: allAverages.find((a) => a.id === s.id)?.maxValueWidth,
      }));
      const drawn = new Set(scrubbed.map((v) => v.id));
      onMetricsChange?.([...scrubbed, ...allAverages.filter((a) => !drawn.has(a.id))], true);
      onPointSelect?.(sample);
    },
    [indexMap, seriesInfo, isMetric, allAverages, onMetricsChange, onPointSelect]
  );

  const handleInteractionChange = useCallback(
    (active: boolean) => {
      if (!active) {
        xAxisLabel.current?.setScrub(null);
        onPointSelect?.(null);
        if (allAverages.length > 0) onMetricsChange?.(allAverages, false);
      }
      onInteractionChange?.(active);
    },
    [allAverages, onMetricsChange, onPointSelect, onInteractionChange]
  );

  const describePoint = useCallback(
    (point: Datum, idx: number) => {
      const sample = indexMap[idx];
      const values = seriesInfo.map((s) => {
        const value = formatScrubValue(
          s.config,
          sample === undefined ? undefined : s.rawData[sample],
          isMetric
        );
        const unit = seriesUnit(s.config, isMetric);
        const name = chartLaneName(s.config, t);
        return unit && value !== ABSENT ? `${name} ${value} ${unit}` : `${name} ${value}`;
      });
      return [xLabel(point.x ?? 0), ...values].join(', ');
    },
    [indexMap, seriesInfo, isMetric, t, xLabel]
  );

  const { gesture, scrubIndex, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<Datum>({
      data: chartData,
      accessibilityLabel: t('charts.activityPlot'),
      onSelect: handleSelect,
      onInteractionChange: handleInteractionChange,
      describePoint,
      // A stream is a dense curve, where a crosshair snapping to samples reads as lag.
      crosshairMode: 'finger',
    });

  // Every lane projects x the same way, so the scrub reads one set of pixels for all of them.
  useEffect(() => {
    if (width <= 0) return;
    const bounds = {
      left: GUTTER + PLOT_INSET,
      right: GUTTER + plotRight - PLOT_INSET,
      top: 0,
      bottom: stack.height - LANE_AXIS_HEIGHT,
    };
    syncBounds(bounds);
    syncXCoords(chartData, (d) => xForValue(d.x ?? 0, xDomain, bounds));
  }, [width, plotRight, chartData, xDomain, stack.height, syncBounds, syncXCoords]);

  // What a screen reader hears and the Show data sheet lists: each lane at
  // each plotted point, in its own unit. A stop on a pace lane is a gap, as
  // the line draws it.
  const reading = useMemo(() => {
    const title = t('charts.activityPlot');
    const lanes: SummarySeries[] = seriesInfo.map((s) => {
      const unit = seriesUnit(s.config, isMetric);
      return {
        name: chartLaneName(s.config, t),
        unit: unit || undefined,
        points: chartData.map((d, i) => ({
          label: xLabel(d.x ?? 0),
          key: String(i),
          value: Number.isFinite(d[s.id]) ? (d[s.id] ?? null) : null,
        })),
        format: (v) => {
          const value = formatScrubValue(s.config, v, isMetric);
          return unit ? `${value} ${unit}` : value;
        },
      };
    });
    const xHeader = t(xAxisMode === 'time' ? 'charts.column.time' : 'charts.column.distance');
    return {
      summary: lanesSummary(title, lanes, t),
      table: seriesTable(title, xUnit ? `${xHeader} (${xUnit})` : xHeader, lanes),
    };
  }, [chartData, seriesInfo, isMetric, xAxisMode, xUnit, xLabel, t]);

  const intervalBands = useMemo(
    () =>
      computeIntervalBands(intervals, chartData.length, streams, xAxisMode, isMetric, activityType),
    [intervals, chartData, streams, xAxisMode, isMetric, activityType]
  );

  if (chartData.length === 0 || seriesInfo.length === 0) {
    return (
      <View style={[styles.placeholder, { height: height ?? laneStack(1).height }]}>
        <EmptyState
          variant="inline"
          title={t('activity.noDataAvailable')}
          description={emptyCause ? t(EMPTY_CAUSE_KEYS[emptyCause]) : undefined}
        />
      </View>
    );
  }

  // Nothing is drawn until the width the streams are thinned to is known.
  if (width === 0) {
    return <View style={{ height: stack.height }} onLayout={onLayout} />;
  }

  const scrubbed = chartData[scrubIndex];

  return (
    <ChartErrorBoundary height={stack.height} chartName="Activity Chart">
      <View onLayout={onLayout}>
        <ChartSurface
          summary={reading.summary}
          table={reading.table}
          style={styles.surface}
          testID="activity-plot"
        >
          <GestureDetector gesture={gesture}>
            <View testID="activity-streams-surface" {...accessibilityProps}>
              {seriesInfo.map((lane) => (
                <StreamLane
                  key={lane.id}
                  lane={lane}
                  name={chartLaneName(lane.config, t)}
                  unit={seriesUnit(lane.config, isMetric)}
                  isMetric={isMetric}
                  isDark={isDark}
                  titleHeight={titleHeight}
                  plotHeight={stack.plotHeight}
                  data={chartData}
                  series={accessors[lane.id] ?? {}}
                  xDomain={xDomain}
                  bands={intervalBands}
                  scrubbed={scrubbed}
                  colours={chartColors}
                />
              ))}

              <ChartCrosshair
                style={crosshairStyle}
                topOffset={0}
                bottomOffset={LANE_AXIS_HEIGHT}
              />

              <ChartXAxisLabel
                ref={xAxisLabel}
                xAxisMode={xAxisMode}
                maxX={maxX}
                xUnit={xUnit}
                isDark={isDark}
                // The stats barrel imports this feature back, so its lane
                // geometry is read at render rather than at module load.
                style={[styles.xAxis, { height: LANE_AXIS_HEIGHT }]}
              />
            </View>
          </GestureDetector>
        </ChartSurface>
      </View>
    </ChartErrorBoundary>
  );
});

interface StreamLaneProps {
  lane: SeriesInfo;
  name: string;
  unit: string;
  isMetric: boolean;
  isDark: boolean;
  titleHeight: number;
  plotHeight: number;
  data: Datum[];
  series: Accessor;
  xDomain: Domain;
  bands: IntervalBand[];
  scrubbed: Datum | undefined;
  colours: ReturnType<typeof useChartColors>;
}

/** One stream's lane: its title, its value gutter and its plot. */
function StreamLane({
  lane,
  name,
  unit,
  isMetric,
  isDark,
  titleHeight,
  plotHeight,
  data,
  series,
  xDomain,
  bands,
  scrubbed,
  colours,
}: StreamLaneProps) {
  const [bottom, top] = lane.domain;
  const average = useMemo(
    () => (lane.kind === 'line' ? seriesAverage(lane.config, lane.rawData) : null),
    [lane]
  );
  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];

  return (
    <View testID={`activity-lane-${lane.id}`}>
      <View style={[styles.title, { minHeight: titleHeight }]}>
        <DenseText
          style={[chartStyles.chartLabelStrong, isDark && chartStyles.chartLabelStrongDark]}
        >
          {laneTitle(name, unit)}
        </DenseText>
      </View>
      <View style={[styles.laneRow, { height: plotHeight }]}>
        {/* The values are read from the summary, so a screen reader skips the gutter. */}
        <View
          style={styles.gutter}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <DenseText testID={`activity-lane-${lane.id}-max`} style={[labelStyle, styles.tickTop]}>
            {formatScrubValue(lane.config, top, isMetric)}
          </DenseText>
          <DenseText
            testID={`activity-lane-${lane.id}-min`}
            style={[labelStyle, styles.tickBottom]}
          >
            {formatScrubValue(lane.config, bottom, isMetric)}
          </DenseText>
        </View>
        <View style={styles.plot}>
          <ChartCanvas
            data={data}
            x={xOf}
            series={series}
            xDomain={xDomain}
            yDomain={lane.domain}
            padding={PLOT_PADDING}
            baseline={lane.kind !== 'signed'}
          >
            {(frame) => (
              <LaneMarks
                lane={lane}
                frame={frame}
                isDark={isDark}
                average={average}
                bands={bands}
                scrubbed={scrubbed}
                colours={colours}
              />
            )}
          </ChartCanvas>
        </View>
      </View>
    </View>
  );
}

interface LaneMarksProps {
  lane: SeriesInfo;
  frame: ChartFrame<string>;
  isDark: boolean;
  average: number | null;
  bands: IntervalBand[];
  scrubbed: Datum | undefined;
  colours: ReturnType<typeof useChartColors>;
}

/** What a lane draws inside its canvas, back to front. */
function LaneMarks({ lane, frame, isDark, average, bands, scrubbed, colours }: LaneMarksProps) {
  const { bounds, xFor, yFor } = frame;
  const runs = frame.runs[lane.id] ?? [];
  const lineColour =
    lane.kind === 'signed'
      ? chartStreamColour('gradeUp', isDark)
      : chartStreamColour(lane.config.stream, isDark);
  const value = scrubbed?.[lane.id];
  const x = scrubbed?.x;

  return (
    <>
      {/* Each interval's band behind the stream, its colour along its top edge */}
      {bands.map((band, i) => {
        const x1 = xFor(band.startX);
        const width = Math.max(1, xFor(band.endX) - x1);
        const colour = resolveBandColour(band.bandColour, isDark);
        return (
          <React.Fragment key={`band-${i}`}>
            <Rect
              x={x1}
              y={0}
              width={width}
              height={frame.height}
              color={colour}
              opacity={opacity.tint3}
            />
            <Rect x={x1} y={0} width={width} height={stroke.two} color={colour} />
          </React.Fragment>
        );
      })}

      {lane.kind === 'context'
        ? runs.map((run, i) => (
            <React.Fragment key={`context-${i}`}>
              <ContextArea
                points={run}
                floor={bounds.bottom}
                color={chartStreamColour('contextFill', isDark)}
              />
              <CurveLine points={run} color={lineColour} />
            </React.Fragment>
          ))
        : null}

      {lane.kind === 'signed' ? (
        <>
          {runs.map((run, i) => (
            <SignedArea
              key={`signed-${i}`}
              points={run}
              zero={yFor(0)}
              width={frame.width}
              height={frame.height}
              above={chartStreamColour('gradeUp', isDark)}
              below={chartStreamColour('gradeDown', isDark)}
            />
          ))}
          <SkiaLine
            p1={vec(bounds.left, yFor(0))}
            p2={vec(bounds.right, yFor(0))}
            color={colours.axis}
            strokeWidth={chartStroke.axis}
          />
        </>
      ) : null}

      {lane.kind === 'line'
        ? runs.map((run, i) => (
            <React.Fragment key={`line-${i}`}>
              <CurveArea
                points={run}
                yDomain={lane.domain}
                y0={bounds.bottom}
                color={lineColour}
                isDark={isDark}
              />
              <CurveLine points={run} color={lineColour} />
            </React.Fragment>
          ))
        : null}

      {/* The stream's own average, dashed across the lane */}
      {average != null ? (
        <SkiaLine
          p1={vec(bounds.left, yFor(average))}
          p2={vec(bounds.right, yFor(average))}
          color={colours.reference}
          strokeWidth={chartStroke.reference}
        >
          <DashPathEffect intervals={REFERENCE_DASH} />
        </SkiaLine>
      ) : null}

      {/* Each WORK interval's own average, on the lane that draws that stream */}
      {lane.id === 'power' || lane.id === 'heartrate'
        ? bands.map((band, i) => {
            const bandAverage = band.averages[lane.id as 'power' | 'heartrate'];
            if (bandAverage == null) return null;
            const y = yFor(bandAverage);
            return (
              <SkiaLine
                key={`band-average-${i}`}
                p1={vec(xFor(band.startX), y)}
                p2={vec(xFor(band.endX), y)}
                color={resolveBandColour(band.bandColour, isDark)}
                strokeWidth={chartStroke.series}
              >
                <DashPathEffect intervals={REFERENCE_DASH} />
              </SkiaLine>
            );
          })
        : null}

      <ScrubDot
        at={
          x !== undefined && value !== undefined && Number.isFinite(value)
            ? { x: xFor(x), y: yFor(value) }
            : null
        }
        color={lineColour}
      />
    </>
  );
}

/**
 * The grey area under a context stream, down to its lane's floor. It is the
 * ground or the air the effort happened in rather than a quantity read from
 * zero, so it fills to the floor however high the floor sits.
 */
function ContextArea({
  points,
  floor,
  color,
}: {
  points: readonly ProjectedPoint[];
  floor: number;
  color: string;
}) {
  const path = useMemo(() => {
    const d = curveAreaSvg(points, floor);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [points, floor]);
  if (!path) return null;
  return <Path path={path} style="fill" color={color} />;
}

/** The fill between a signed stream and zero: one colour above it, the other below. */
function SignedArea({
  points,
  zero,
  width,
  height,
  above,
  below,
}: {
  points: readonly ProjectedPoint[];
  zero: number;
  width: number;
  height: number;
  above: string;
  below: string;
}) {
  const path = useMemo(() => {
    const d = curveAreaSvg(points, zero);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [points, zero]);
  if (!path) return null;
  return (
    <>
      <Group clip={Skia.XYWHRect(0, 0, width, zero)}>
        <Path path={path} style="fill" color={above} />
      </Group>
      <Group clip={Skia.XYWHRect(0, zero, width, Math.max(0, height - zero))}>
        <Path path={path} style="fill" color={below} />
      </Group>
    </>
  );
}

const styles = StyleSheet.create({
  // The lanes set their own height, so the plot is sized by them rather than filling.
  surface: {
    flex: 0,
  },
  title: {
    justifyContent: 'flex-end',
  },
  laneRow: {
    flexDirection: 'row',
  },
  gutter: {
    width: GUTTER,
  },
  tickTop: {
    position: 'absolute',
    top: 0,
    right: spacing.xs,
    textAlign: 'right',
  },
  tickBottom: {
    position: 'absolute',
    bottom: 0,
    right: spacing.xs,
    textAlign: 'right',
  },
  plot: {
    flex: 1,
  },
  xAxis: {
    paddingLeft: GUTTER,
  },
  placeholder: {
    justifyContent: 'center',
  },
});
