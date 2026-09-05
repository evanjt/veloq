import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Canvas, Line as SkiaLine, vec } from '@shopify/react-native-skia';

import {
  chartBoundsFor,
  dataExtent,
  gridLineYs,
  projectPoints,
  xForValue,
  yForValue,
  type ChartPadding,
  type Domain,
  type ProjectedPoint,
} from './cartesian';
import type { ChartBounds } from './useChartGestures';
import { useChartColors } from './useChartColors';

/** Everything a chart body needs to draw into the measured box. */
export interface ChartFrame<K extends string> {
  points: Record<K, ProjectedPoint[]>;
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
  xDomain?: Domain;
  yDomain: Domain;
  padding?: Partial<ChartPadding>;
  /** Horizontal rules spread over the box, 0 for none. */
  grid?: number;
  gridColor?: string;
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
  gridColor,
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
    for (const key of Object.keys(series) as K[]) {
      points[key] = projectPoints(data, x, series[key], xd, yDomain, bounds);
    }
    return {
      points,
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
      {frame && (
        <Canvas style={StyleSheet.absoluteFill}>
          {gridLineYs(frame.bounds, grid).map((y) => (
            <SkiaLine
              key={y}
              p1={vec(frame.bounds.left, y)}
              p2={vec(frame.bounds.right, y)}
              color={gridColor ?? chartColors.grid}
              strokeWidth={StyleSheet.hairlineWidth}
            />
          ))}
          {children(frame)}
        </Canvas>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
