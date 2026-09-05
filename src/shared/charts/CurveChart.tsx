import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from '@/shared/app';
import { chartStyles, spacing } from '@/theme';

import { domainContains, type Domain } from './cartesian';
import { ChartCanvas } from './ChartCanvas';
import { ChartCrosshair } from './ChartCrosshair';
import { CurveLine } from './CurvePaths';
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
  /** Plain strings spread evenly, or labels placed by data value. */
  xLabels: readonly string[] | readonly PlacedLabel[];
  formatY: (value: number) => string;
  /** Names the top y-axis label, for a caller whose axis unit is under test. */
  topAxisTestID?: string;
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

  const placed = xLabels.length > 0 && typeof xLabels[0] !== 'string';
  const placedLabels = useMemo(() => {
    if (!placed || width <= 0) return [];
    const [xMin, xMax] = xDomain ?? [0, 1];
    const span = xMax - xMin || 1;
    return (xLabels as readonly PlacedLabel[])
      .map(({ label, value }) => ({ label, ratio: (value - xMin) / span }))
      .filter(({ ratio }) => ratio >= -0.05 && ratio <= 1.05)
      .map(({ label, ratio }) => ({ label, left: ratio * width - PLACED_LABEL_HALF_WIDTH }));
  }, [placed, xLabels, xDomain, width]);

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
            return (
              <>
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
                <CurveLine points={points.y} color={chartColors.casing} strokeWidth={2.5} />
                <CurveLine points={points.y} color={color} strokeWidth={1.5} />
              </>
            );
          }}
        </ChartCanvas>

        <ChartCrosshair style={crosshairStyle} />

        {placed ? (
          <View style={styles.xAxisPlaced} pointerEvents="none">
            {placedLabels.map((item) => (
              <Text key={item.label} style={[labelStyle, styles.placedLabel, { left: item.left }]}>
                {item.label}
              </Text>
            ))}
          </View>
        ) : (
          <View style={styles.xAxisSpread} pointerEvents="none">
            {(xLabels as readonly string[]).map((label) => (
              <Text key={label} style={labelStyle}>
                {label}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.yAxis} pointerEvents="none">
          <Text testID={topAxisTestID} style={labelStyle}>
            {formatY(yDomain[1])}
          </Text>
          <Text style={labelStyle}>{formatY(midY)}</Text>
          <Text style={labelStyle}>{formatY(yDomain[0])}</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  xAxisSpread: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
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
