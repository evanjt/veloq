import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Canvas, DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';

import {
  chartBoundsFor,
  dataExtent,
  gridLineYs,
  projectRuns,
  xForValue,
  yForValue,
  type ChartPadding,
  type Domain,
  type ProjectedPoint,
} from './cartesian';
import { GRID_DASH, chartStroke } from './chartMarks';
import type { ChartBounds } from './useChartGestures';
import { useChartColors } from './useChartColors';

/** Everything a chart body needs to draw into the measured box. */
export interface ChartFrame<K extends string> {
  /** Every finite sample per series, for the crosshair and gestures. */
  points: Record<K, ProjectedPoint[]>;
  /** The same samples split where a sample is missing, one entry per unbroken stretch. */
  runs: Record<K, ProjectedPoint[][]>;
  bounds: ChartBounds;
  width: number;
  height: number;
  xDomain: Domain;
  yDomain: Domain;
  xFor: (value: number) => number;
  yFor: (value: number) => number;
}

export interface ChartCanvasProps<T, K extends string> {
  data: readonly T[];
  x: (datum: T) => number;
  /** One accessor per drawn series, keyed by the name the body reads back. */
  series: Record<K, (datum: T) => number | null | undefined>;
  /** Defaults to the extent of the x values. */
  xDomain?: Domain | undefined;
  yDomain: Domain;
  padding?: Partial<ChartPadding>;
  /** Horizontal rules spread over the box, 0 for none. */
  grid?: number;
  /** Horizontal rules at these y values, the ticks an axis labels, in place of `grid`. */
  gridValues?: readonly number[] | undefined;
  gridColor?: string;
  /** The solid axis under the plot. On by default; off where the chart draws its own. */
  baseline?: boolean;
  style?: StyleProp<ViewStyle>;
  children: (frame: ChartFrame<K>) => React.ReactNode;
}

const NO_PADDING: ChartPadding = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * A Skia canvas that fills its parent, measures itself, and projects the data
 * into pixels for the body to draw. The domain is honoured exactly, so an
 * overlay label at `yDomain[1]` sits on the top edge of the plot.
 */
export function ChartCanvas<T, K extends string>({
  data,
  x,
  series,
  xDomain,
  yDomain,
  padding,
  grid = 0,
  gridValues,
  gridColor,
  baseline = true,
  style,
  children,
}: ChartCanvasProps<T, K>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const chartColors = useChartColors();

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  const frame = useMemo<ChartFrame<K> | null>(() => {
    if (!size || size.width <= 0 || size.height <= 0) return null;
    const pad = { ...NO_PADDING, ...padding };
    const bounds = chartBoundsFor(size.width, size.height, pad);
    const xd = xDomain ?? dataExtent(data, x);
    const points = {} as Record<K, ProjectedPoint[]>;
    const runs = {} as Record<K, ProjectedPoint[][]>;
    for (const key of Object.keys(series) as K[]) {
      runs[key] = projectRuns(data, x, series[key], xd, yDomain, bounds);
      points[key] = runs[key].flat();
    }
    return {
      points,
      runs,
      bounds,
      width: size.width,
      height: size.height,
      xDomain: xd,
      yDomain,
      xFor: (value: number) => xForValue(value, xd, bounds),
      yFor: (value: number) => yForValue(value, yDomain, bounds),
    };
  }, [size, padding, xDomain, yDomain, data, x, series]);

  return (
    <View style={[styles.fill, style]} onLayout={onLayout}>
      {frame ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {(gridValues ? gridValues.map(frame.yFor) : gridLineYs(frame.bounds, grid))
            .filter((y) => !baseline || Math.abs(y - frame.bounds.bottom) >= chartStroke.grid)
            .map((y) => (
              <SkiaLine
                key={y}
                p1={vec(frame.bounds.left, y)}
                p2={vec(frame.bounds.right, y)}
                color={gridColor ?? chartColors.grid}
                strokeWidth={chartStroke.grid}
              >
                <DashPathEffect intervals={GRID_DASH} />
              </SkiaLine>
            ))}
          {baseline ? (
            <SkiaLine
              p1={vec(frame.bounds.left, frame.bounds.bottom)}
              p2={vec(frame.bounds.right, frame.bounds.bottom)}
              color={chartColors.baseline}
              strokeWidth={chartStroke.axis}
            />
          ) : null}
          {children(frame)}
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
