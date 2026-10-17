import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { Circle, DashPathEffect, Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { chartStyles, ink, typography } from '@/theme';

import { dataExtent, domainContains, placeLabels, type Domain } from './cartesian';
import { ChartCanvas } from './ChartCanvas';
import { ChartCrosshair } from './ChartCrosshair';
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

export interface CurveChartProps<T extends ChartSample> {
  data: readonly T[];
  yDomain: Domain;
  /** Defaults to the extent of the data. */
  xDomain?: Domain;
  color: string;
  /** A dashed horizontal rule, drawn only when its value lies inside `yDomain`. */
  referenceLine?: { value: number; color: string } | null;
  /** Labels placed by data value, so each sits on the value it names. */
  xLabels: readonly PlacedLabel[];
  formatY: (value: number) => string;
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
   * A ringed dot on one sample, such as a record, by its index in `data`. As
   * bars, the marked bar is drawn in full and the others faded.
   */
  marker?: { index: number; color: string } | null;
  /** One bar per sample from zero, for totals over a period, in place of the line. */
  bars?: boolean;
  crosshairMode?: 'point' | 'finger';
  /** What a screen reader reads for a stepped sample. Defaults to its y value alone. */
  describePoint?: (point: T) => string;
  onSelect?: (point: T) => void;
  onInteractionChange?: (active: boolean) => void;
  testID?: string;
}

// The top label is centred on the plot's top edge, so half a line is kept
// above it; the x labels sit in a strip under the plot rather than over it.
const X_STRIP = typography.caption.lineHeight;
const PADDING = { top: typography.caption.lineHeight / 2, bottom: X_STRIP } as const;
const PLACED_LABEL_HALF_WIDTH = 15;
/** The share of the gap between neighbouring samples a bar takes. */
const BAR_FILL = 0.7;
const BAR_MIN_WIDTH = 2;
const FADED_BAR = 0.45;

/** The narrowest gap between neighbouring samples, which every bar's width is cut from. */
function barWidth(xs: readonly number[], span: number): number {
  let gap = span;
  xs.forEach((x, i) => {
    const previous = xs[i - 1];
    if (previous !== undefined) gap = Math.min(gap, Math.abs(x - previous));
  });
  return Math.max(gap * BAR_FILL, BAR_MIN_WIDTH);
}

/**
 * One line over a log or linear x axis with a casing stroke, an optional
 * reference rule, a scrub crosshair and a y gutter labelling its ends and
 * middle. The header, legend and any footer belong to the caller.
 */
export function CurveChart<T extends ChartSample>({
  data,
  yDomain,
  xDomain,
  color,
  referenceLine,
  xLabels,
  formatY,
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
  testID,
}: CurveChartProps<T>) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const { width, onLayout } = useMeasuredWidth();

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

  const { gesture, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<T>({
      data: data as T[],
      onSelect,
      onInteractionChange,
      crosshairMode,
      describePoint: describe,
    });

  const x = useCallback((d: T) => d.x, []);
  const series = useMemo(() => ({ y: (d: T) => d.y }), []);

  const placedLabels = useMemo(
    () => placeLabels(xLabels, xDomain ?? dataExtent(data, x), width, PLACED_LABEL_HALF_WIDTH),
    [xLabels, xDomain, data, x, width]
  );

  const labelStyle = [chartStyles.axisLabel, isDark && chartStyles.axisLabelDark];
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

  return (
    <ChartSurface summary={spoken.summary} table={spoken.table}>
      <View style={styles.row} testID={testID}>
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
              {({ points, bounds, yFor }) => {
                syncBounds(bounds);
                syncXCoords(points.y, (p) => p.x);
                const marked = marker ? points.y[marker.index] : undefined;
                if (bars) {
                  const zero = yFor(Math.min(Math.max(0, yDomain[0]), yDomain[1]));
                  const width = barWidth(
                    points.y.map((p) => p.x),
                    bounds.right - bounds.left
                  );
                  return (
                    <>
                      {points.y.map((p, i) => (
                        <Rect
                          key={i}
                          x={p.x - width / 2}
                          y={Math.min(p.y, zero)}
                          width={width}
                          height={Math.abs(zero - p.y)}
                          color={color}
                          opacity={marker && i !== marker.index ? FADED_BAR : 1}
                          {...(data[i]?.partial
                            ? { style: 'stroke' as const, strokeWidth: 1.5 }
                            : {})}
                        />
                      ))}
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
                        color={referenceLine.color}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[6, 4]} />
                      </SkiaLine>
                    ) : null}
                    <CurveLine
                      points={points.y}
                      color={chartColors.casing}
                      strokeWidth={2.5}
                      curve={curve}
                    />
                    <CurveLine points={points.y} color={color} strokeWidth={1.5} curve={curve} />
                    {pointColor
                      ? points.y.map((p, i) =>
                          i === marker?.index ? null : (
                            <Circle key={i} cx={p.x} cy={p.y} r={3} color={pointColor} />
                          )
                        )
                      : null}
                    {marker && marked ? (
                      <>
                        <Circle
                          cx={marked.x}
                          cy={marked.y}
                          r={7}
                          color={marker.color}
                          opacity={0.3}
                        />
                        <Circle cx={marked.x} cy={marked.y} r={5} color={marker.color} />
                        <Circle cx={marked.x} cy={marked.y} r={2.5} color={ink.white} />
                      </>
                    ) : null}
                  </>
                );
              }}
            </ChartCanvas>

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
    flex: 1,
    flexDirection: 'row',
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
