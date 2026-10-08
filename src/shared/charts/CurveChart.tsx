import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import {
  Circle,
  DashPathEffect,
  LinearGradient,
  Line as SkiaLine,
  vec,
} from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from '@/shared/app';
import { chartStyles, ink, spacing } from '@/theme';

import { dataExtent, domainContains, placeLabels, type Domain } from './cartesian';
import { ChartCanvas } from './ChartCanvas';
import { ChartCrosshair } from './ChartCrosshair';
import { CurveArea, CurveLine } from './CurvePaths';
import type { CurveKind } from './curvePath';
import { useChartColors } from './useChartColors';
import { useChartGestures } from './useChartGestures';

/** An x label pinned to a data value, for a log or otherwise uneven axis. */
export interface PlacedLabel {
  label: string;
  value: number;
}

export interface CurveChartProps<T extends { x: number; y: number }> {
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
  /** Names the top y-axis label, for a caller whose axis unit is under test. */
  topAxisTestID?: string;
  /** How the line runs between samples. Discrete samples read honestly as `linear`. */
  curve?: CurveKind;
  /** Fills under the line with a fading wash of the line colour. */
  area?: boolean;
  /** A dot on every sample, for a series of discrete events. */
  pointColor?: string;
  /** A ringed dot on one sample, such as a record, by its index in `data`. */
  marker?: { index: number; color: string } | null;
  crosshairMode?: 'point' | 'finger';
  onSelect?: (point: T) => void;
  onInteractionChange?: (active: boolean) => void;
  testID?: string;
}

const PADDING = { top: spacing.xs } as const;
const GRID_LINES = 5;
const PLACED_LABEL_HALF_WIDTH = 15;

/**
 * One line over a log or linear x axis with a casing stroke, an optional
 * reference rule, a scrub crosshair and three y labels. The header, legend
 * and any footer belong to the caller.
 */
export function CurveChart<T extends { x: number; y: number }>({
  data,
  yDomain,
  xDomain,
  color,
  referenceLine,
  xLabels,
  formatY,
  topAxisTestID,
  curve = 'natural',
  area = false,
  pointColor,
  marker,
  crosshairMode = 'point',
  onSelect,
  onInteractionChange,
  testID,
}: CurveChartProps<T>) {
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const [width, setWidth] = useState(0);

  const { gesture, crosshairStyle, syncBounds, syncXCoords } = useChartGestures<T>({
    data: data as T[],
    onSelect,
    onInteractionChange,
    crosshairMode,
  });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const x = useCallback((d: T) => d.x, []);
  const series = useMemo(() => ({ y: (d: T) => d.y }), []);

  const placedLabels = useMemo(
    () => placeLabels(xLabels, xDomain ?? dataExtent(data, x), width, PLACED_LABEL_HALF_WIDTH),
    [xLabels, xDomain, data, x, width]
  );

  const labelStyle = [chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark];
  const midY = (yDomain[0] + yDomain[1]) / 2;
  const showReference = referenceLine != null && domainContains(yDomain, referenceLine.value);

  return (
    <GestureDetector gesture={gesture}>
      <View style={chartStyles.chartWrapper} onLayout={onLayout} testID={testID}>
        <ChartCanvas
          data={data}
          x={x}
          series={series}
          xDomain={xDomain}
          yDomain={yDomain}
          padding={PADDING}
          grid={GRID_LINES}
        >
          {({ points, bounds, yFor }) => {
            syncBounds(bounds);
            syncXCoords(points.y, (p) => p.x);
            const marked = marker ? points.y[marker.index] : undefined;
            return (
              <>
                {area && (
                  <CurveArea points={points.y} y0={bounds.bottom} curve={curve}>
                    <LinearGradient
                      start={vec(0, bounds.top)}
                      end={vec(0, bounds.bottom)}
                      colors={[`${color}30`, `${color}05`]}
                    />
                  </CurveArea>
                )}
                {showReference && (
                  <SkiaLine
                    p1={vec(bounds.left, yFor(referenceLine.value))}
                    p2={vec(bounds.right, yFor(referenceLine.value))}
                    color={referenceLine.color}
                    strokeWidth={1}
                  >
                    <DashPathEffect intervals={[6, 4]} />
                  </SkiaLine>
                )}
                <CurveLine
                  points={points.y}
                  color={chartColors.casing}
                  strokeWidth={2.5}
                  curve={curve}
                />
                <CurveLine points={points.y} color={color} strokeWidth={1.5} curve={curve} />
                {pointColor &&
                  points.y.map((p, i) =>
                    i === marker?.index ? null : (
                      <Circle key={i} cx={p.x} cy={p.y} r={3} color={pointColor} />
                    )
                  )}
                {marker && marked && (
                  <>
                    <Circle cx={marked.x} cy={marked.y} r={7} color={marker.color} opacity={0.3} />
                    <Circle cx={marked.x} cy={marked.y} r={5} color={marker.color} />
                    <Circle cx={marked.x} cy={marked.y} r={2.5} color={ink.white} />
                  </>
                )}
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

        <View style={styles.yAxis} pointerEvents="none">
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} testID={topAxisTestID} style={labelStyle}>
            {formatY(yDomain[1])}
          </Text>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={labelStyle}>
            {formatY(midY)}
          </Text>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={labelStyle}>
            {formatY(yDomain[0])}
          </Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  xAxisPlaced: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: spacing.md,
  },
  placedLabel: {
    position: 'absolute',
  },
  yAxis: {
    position: 'absolute',
    top: spacing.xs,
    bottom: 20,
    left: spacing.xs,
    justifyContent: 'space-between',
  },
});
