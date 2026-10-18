import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE, DenseText } from '@/shared/ui/DenseText';
import { DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { chartLabelHalo, chartStyles, spacing, typography } from '@/theme';

import { dataExtent, domainContains, placeLabels, yForValue, type Domain } from './cartesian';
import { ChartCanvas } from './ChartCanvas';
import { ChartCrosshair } from './ChartCrosshair';
import { ChartBar, ChartDot, RecordRing, ReticleMark, ScrubDot } from './ChartMarks';
import {
  REFERENCE_DASH,
  barWidthFor,
  chartStroke,
  groupedBarCentre,
  groupedBarWidth,
} from './chartMarks';
import { ChartSurface } from './ChartSurface';
import { curveSummary, seriesSummary, seriesTable, type SummarySeries } from './chartSummary';
import { CurveArea, CurveLine } from './CurvePaths';
import type { CurveKind } from './curvePath';
import { useChartColors } from './useChartColors';
import { useChartGestures } from './useChartGestures';
import { useMeasuredWidth } from './useMeasuredWidth';
import { YAxisLabels } from './YAxisLabels';

/** A drawn sample. A `partial` one, a total still accruing, is drawn in outline as a bar. */
export interface ChartSample {
  x: number;
  y: number;
  partial?: boolean;
}

/** An x label pinned to a data value, for a log or otherwise uneven axis. */
export interface PlacedLabel {
  label: string;
  value: number;
}

/** How the chart is read without being seen: its spoken summary and its Show data table. */
export interface CurveReading {
  /** The series' name, which heads the summary, the sheet and the value column. */
  title: string;
  /** The x column's header. */
  xHeader: string;
  /** The value column's unit, shown in its header. */
  unit?: string | undefined;
  formatX: (x: number) => string;
  /** How a value is spoken and listed, with its unit. Defaults to `formatY`. */
  formatValue?: (value: number) => string;
  /** A pace, whose best is its lowest value. */
  lowerIsBetter?: boolean;
  /** A series over time reads its latest value, a curve over a duration or distance its ends. */
  shape: 'series' | 'curve';
}

/** A further series drawn beside the first, read off the same samples. */
export interface FurtherSeries<T> {
  y: (datum: T) => number | null | undefined;
  color: string;
}

export interface CurveChartProps<T extends ChartSample> {
  data: readonly T[];
  /**
   * Series drawn beside the first: a line each, or bars grouped with the
   * first's in each sample's slot. The scrub and the reading follow the first.
   */
  others?: readonly FurtherSeries<T>[];
  yDomain: Domain;
  /** Defaults to the extent of the data. */
  xDomain?: Domain;
  color: string;
  /**
   * A dashed horizontal rule in the reference colour, such as a threshold,
   * named by its label on the line at its right end. Drawn only when its value
   * lies inside `yDomain`.
   */
  referenceLine?: { value: number; label: string; testID?: string } | null;
  /** Labels placed by data value, so each sits on the value it names. */
  xLabels: readonly PlacedLabel[];
  formatY: (value: number) => string;
  /**
   * The value axis unit, titled above the y gutter. An axis drawn upside down
   * for a lower-is-better series says that faster is at the top.
   */
  yAxisUnit?: string;
  /**
   * The plot's own height, gutters and labels aside. Without it the plot fills
   * its parent, which then has to be sized.
   */
  plotHeight?: number;
  reading: CurveReading;
  /** Names the top y-axis label, for a caller whose axis unit is under test. */
  topAxisTestID?: string;
  /** How the line runs between samples. Discrete samples read honestly as `linear`. */
  curve?: CurveKind;
  /** Fills under the line with a fading wash of the line colour. */
  area?: boolean;
  /** A dot on every sample, for a series of discrete events. */
  pointColor?: string;
  /**
   * One sample marked by its index in `data`: the record with the gold ring, or
   * this activity or period with the reticle. As bars, the marked sample's bars
   * keep their colour and every other bar is drawn in the muted chart colour.
   */
  marker?: { index: number; kind: 'record' | 'this' } | null;
  /** One bar per sample from zero, for totals over a period, in place of the line. */
  bars?: boolean;
  crosshairMode?: 'point' | 'finger';
  /** What a screen reader reads for a stepped sample. Defaults to its y value alone. */
  describePoint?: (point: T) => string;
  onSelect?: (point: T) => void;
  onInteractionChange?: (active: boolean) => void;
  /** The data is the previous range's, kept on screen while the new range is read. */
  held?: boolean;
  testID?: string;
}

// The top label is centred on the plot's top edge, so half a line is kept
// above it; the x labels sit in a strip under the plot rather than over it.
const X_STRIP = typography.caption.lineHeight;
const PADDING = { top: typography.caption.lineHeight / 2, bottom: X_STRIP } as const;
const PLACED_LABEL_HALF_WIDTH = 15;
const REFERENCE_LABEL_HEIGHT = typography.caption.lineHeight;

/**
 * One line over a log or linear x axis, an optional
 * reference rule, a scrub crosshair and a y gutter labelling its ends and
 * middle. The header, legend and any footer belong to the caller.
 */
const NO_OTHERS: readonly FurtherSeries<ChartSample>[] = [];

export function CurveChart<T extends ChartSample>({
  data,
  others = NO_OTHERS,
  yDomain,
  xDomain,
  color,
  referenceLine,
  xLabels,
  formatY,
  yAxisUnit,
  plotHeight,
  reading,
  topAxisTestID,
  curve = 'natural',
  area = false,
  pointColor,
  marker,
  bars = false,
  crosshairMode = 'point',
  describePoint,
  onSelect,
  onInteractionChange,
  held = false,
  testID,
}: CurveChartProps<T>) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const { width, onLayout: onWidth } = useMeasuredWidth();
  const [boxHeight, setBoxHeight] = useState(0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onWidth(event);
      setBoxHeight(event.nativeEvent.layout.height);
    },
    [onWidth]
  );

  const describe = useCallback(
    (point: T) => (describePoint ? describePoint(point) : formatY(point.y)),
    [describePoint, formatY]
  );

  const spoken = useMemo(() => {
    const series: SummarySeries = {
      name: reading.title,
      unit: reading.unit,
      points: data.map((d) => ({ label: reading.formatX(d.x), value: d.y })),
      format: reading.formatValue ?? formatY,
      lowerIsBetter: reading.lowerIsBetter,
    };
    const summarise = reading.shape === 'curve' ? curveSummary : seriesSummary;
    return {
      summary: summarise(series, t),
      table: seriesTable(reading.title, reading.xHeader, [series]),
    };
  }, [data, reading, formatY, t]);

  const { gesture, crosshairStyle, syncBounds, syncXCoords, accessibilityProps, scrubIndex } =
    useChartGestures<T>({
      data: data as T[],
      accessibilityLabel: reading.title,
      onSelect,
      onInteractionChange,
      crosshairMode,
      describePoint: describe,
    });

  const x = useCallback((d: T) => d.x, []);
  const series = useMemo(() => {
    const accessors: Record<'y' | `other${number}`, (d: T) => number | null | undefined> = {
      y: (d: T) => d.y,
    };
    others.forEach((other, i) => {
      accessors[`other${i}`] = other.y;
    });
    return accessors;
  }, [others]);

  const placedLabels = useMemo(
    () => placeLabels(xLabels, xDomain ?? dataExtent(data, x), width, PLACED_LABEL_HALF_WIDTH),
    [xLabels, xDomain, data, x, width]
  );

  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];
  const yTicks = useMemo(
    () =>
      [yDomain[1], (yDomain[0] + yDomain[1]) / 2, yDomain[0]].map((value, i) => ({
        value,
        label: formatY(value),
        testID: i === 0 ? topAxisTestID : undefined,
      })),
    [yDomain, formatY, topAxisTestID]
  );
  const gridValues = useMemo(() => yTicks.map((tick) => tick.value), [yTicks]);
  const showReference = referenceLine != null && domainContains(yDomain, referenceLine.value);
  // The label sits on the rule at its right end, and under it when the rule is
  // too near the top of the box to hold it above.
  const referenceLabelTop = useMemo(() => {
    if (!showReference || boxHeight <= 0) return null;
    const y = yForValue(referenceLine.value, yDomain, {
      left: 0,
      right: 0,
      top: PADDING.top,
      bottom: boxHeight - PADDING.bottom,
    });
    const above = y - REFERENCE_LABEL_HEIGHT;
    return above >= 0 ? above : y;
  }, [showReference, referenceLine, yDomain, boxHeight]);
  const axisTitle =
    yAxisUnit == null
      ? null
      : reading.lowerIsBetter && yDomain[0] > yDomain[1]
        ? t('charts.axisFasterAtTop', { unit: yAxisUnit })
        : yAxisUnit;
  const plotRow =
    plotHeight != null ? { height: plotHeight + PADDING.top + PADDING.bottom } : styles.fill;

  return (
    <ChartSurface
      summary={spoken.summary}
      table={spoken.table}
      held={held}
      {...(plotHeight != null && { style: styles.sized })}
    >
      {axisTitle != null ? (
        <DenseText style={labelStyle} {...(testID ? { testID: `${testID}-axis-title` } : {})}>
          {axisTitle}
        </DenseText>
      ) : null}
      <View style={[styles.row, plotRow]} testID={testID}>
        <YAxisLabels ticks={yTicks} domain={yDomain} padding={PADDING} />
        <GestureDetector gesture={gesture}>
          <View style={chartStyles.chartWrapper} onLayout={onLayout} {...accessibilityProps}>
            <ChartCanvas
              data={data}
              x={x}
              series={series}
              xDomain={xDomain}
              yDomain={yDomain}
              padding={PADDING}
              gridValues={gridValues}
            >
              {({ points, bounds, xFor, yFor }) => {
                syncBounds(bounds);
                syncXCoords(points.y, (p) => p.x);
                const marked = marker ? points.y[marker.index] : undefined;
                if (bars) {
                  const zero = yFor(Math.min(Math.max(0, yDomain[0]), yDomain[1]));
                  const slot = barWidthFor(
                    data.map((d) => xFor(d.x)),
                    bounds.right - bounds.left
                  );
                  const count = others.length + 1;
                  const width = count > 1 ? groupedBarWidth(slot, count) : slot;
                  const drawn = [{ y: (d: T) => d.y, color }, ...others];
                  return (
                    <>
                      {data.map((d, i) =>
                        drawn.map((each, s) => {
                          const value = each.y(d);
                          if (value == null || !Number.isFinite(value)) return null;
                          const centre = xFor(d.x);
                          const muted = marker != null && i !== marker.index;
                          return (
                            <ChartBar
                              key={`${i}-${s}`}
                              x={count > 1 ? groupedBarCentre(centre, width, count, s) : centre}
                              from={zero}
                              to={yFor(value)}
                              width={width}
                              color={muted ? chartColors.muted : each.color}
                              outline={d.partial === true}
                            />
                          );
                        })
                      )}
                    </>
                  );
                }
                return (
                  <>
                    {area ? (
                      <CurveArea
                        points={points.y}
                        yDomain={yDomain}
                        y0={bounds.bottom}
                        color={color}
                        isDark={isDark}
                        curve={curve}
                      />
                    ) : null}
                    {showReference ? (
                      <SkiaLine
                        p1={vec(bounds.left, yFor(referenceLine.value))}
                        p2={vec(bounds.right, yFor(referenceLine.value))}
                        color={chartColors.reference}
                        strokeWidth={chartStroke.reference}
                      >
                        <DashPathEffect intervals={REFERENCE_DASH} />
                      </SkiaLine>
                    ) : null}
                    {others.map((other, i) => (
                      <CurveLine
                        key={i}
                        points={points[`other${i}`] ?? []}
                        color={other.color}
                        curve={curve}
                      />
                    ))}
                    <CurveLine points={points.y} color={color} curve={curve} />
                    {pointColor
                      ? points.y.map((p, i) => (
                          <ChartDot key={i} x={p.x} y={p.y} color={pointColor} />
                        ))
                      : null}
                    {marker && marked ? (
                      <>
                        <ChartDot
                          x={marked.x}
                          y={marked.y}
                          color={marker.kind === 'record' ? chartColors.achievement : color}
                        />
                        {marker.kind === 'record' ? (
                          <RecordRing x={marked.x} y={marked.y} />
                        ) : (
                          <ReticleMark x={marked.x} y={marked.y} />
                        )}
                      </>
                    ) : null}
                    <ScrubDot at={points.y[scrubIndex]} color={color} />
                  </>
                );
              }}
            </ChartCanvas>

            {showReference && referenceLabelTop != null ? (
              <DenseText
                style={[
                  chartStyles.chartLabelStrong,
                  isDark && chartStyles.chartLabelStrongDark,
                  chartLabelHalo,
                  { textShadowColor: chartColors.surface },
                  styles.referenceLabel,
                  { top: referenceLabelTop },
                ]}
                pointerEvents="none"
                {...(referenceLine.testID ? { testID: referenceLine.testID } : {})}
              >
                {referenceLine.label}
              </DenseText>
            ) : null}

            <ChartCrosshair style={crosshairStyle} />

            <View style={styles.xAxisPlaced} pointerEvents="none">
              {placedLabels.map((item) => (
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  key={item.label}
                  style={[labelStyle, styles.placedLabel, { left: item.left }]}
                >
                  {item.label}
                </Text>
              ))}
            </View>
          </View>
        </GestureDetector>
      </View>
    </ChartSurface>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  fill: {
    flex: 1,
  },
  sized: {
    flex: 0,
  },
  referenceLabel: {
    position: 'absolute',
    right: spacing.xs,
  },
  xAxisPlaced: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: X_STRIP,
  },
  placedLabel: {
    position: 'absolute',
  },
});
