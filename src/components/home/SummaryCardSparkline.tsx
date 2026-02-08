import React, { memo, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { CartesianChart, Line } from 'victory-native';
import { Shadow } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { darkColors, colors } from '@/theme';

// Form zone colors (matching intervals.icu)
function getFormZoneColor(form: number): string {
  if (form < -30) return '#EF5350'; // High Risk - Red
  if (form < -10) return '#66BB6A'; // Optimal - Green
  if (form < 5) return '#9E9E9E'; // Grey Zone - Grey
  if (form < 25) return '#81C784'; // Fresh - Light Green
  return '#64B5F6'; // Transition - Blue
}

interface SummaryCardSparklineProps {
  data: number[]; // values (oldest to newest)
  color: string; // Fallback color (used for non-form metrics)
  width?: number; // Default 140
  height?: number; // Default 48
  label?: string; // Optional label inside chart (e.g., "30d")
  useZoneColors?: boolean; // Color line segments by form zone
}

interface Segment {
  points: { x: number; y: number }[];
  color: string;
}

/**
 * Sparkline for Summary Card displaying trend.
 * Supports zone-colored segments for form data.
 */
export const SummaryCardSparkline = memo(function SummaryCardSparkline({
  data,
  color,
  width = 140,
  height = 48,
  label,
  useZoneColors = true,
}: SummaryCardSparklineProps) {
  const { isDark } = useTheme();

  // Transform data array into chart points
  const chartData = useMemo(() => {
    return data.map((value, index) => ({
      x: index,
      y: value,
    }));
  }, [data]);

  // Split data into segments by zone color
  const segments = useMemo((): Segment[] => {
    if (!useZoneColors || data.length < 2) return [];

    const result: Segment[] = [];
    let currentColor = getFormZoneColor(data[0]);
    let currentSegment: { x: number; y: number }[] = [{ x: 0, y: data[0] }];

    for (let i = 1; i < data.length; i++) {
      const pointColor = getFormZoneColor(data[i]);
      const point = { x: i, y: data[i] };

      if (pointColor !== currentColor) {
        // Color changed - end current segment with this point and start new one
        currentSegment.push(point);
        result.push({ points: currentSegment, color: currentColor });
        currentSegment = [point]; // New segment starts with overlap point
        currentColor = pointColor;
      } else {
        currentSegment.push(point);
      }
    }

    // Push final segment
    if (currentSegment.length > 0) {
      result.push({ points: currentSegment, color: currentColor });
    }

    return result;
  }, [data, useZoneColors]);

  // Calculate y-axis domain
  const domain = useMemo(() => {
    if (data.length === 0) return { y: [-30, 30] as [number, number] };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    const padding = Math.max(range * 0.3, 5);
    return { y: [min - padding, max + padding] as [number, number] };
  }, [data]);

  if (data.length === 0) {
    return <View style={{ width, height }} />;
  }

  return (
    <View style={[styles.container, { width, height }]}>
      <CartesianChart
        data={chartData}
        xKey="x"
        yKeys={['y']}
        domain={domain}
        padding={{ left: 0, right: 0, top: 2, bottom: 2 }}
      >
        {({ points, chartBounds }) => {
          // If using zone colors, render each segment separately
          if (useZoneColors && segments.length > 0) {
            const xScale = (chartBounds.right - chartBounds.left) / (data.length - 1);
            const yRange = domain.y[1] - domain.y[0];
            const yScale = (chartBounds.bottom - chartBounds.top) / yRange;

            return (
              <>
                {segments.map((segment, idx) => {
                  // Map segment points to chart coordinates
                  // Victory Native's Line expects PointsArray with xValue/yValue
                  const mappedPoints = segment.points.map((p) => ({
                    x: chartBounds.left + p.x * xScale,
                    xValue: p.x,
                    y: chartBounds.top + (domain.y[1] - p.y) * yScale,
                    yValue: p.y,
                  }));

                  return (
                    <Line
                      key={idx}
                      points={mappedPoints}
                      color={segment.color}
                      strokeWidth={2.5}
                      curveType="natural"
                    >
                      <Shadow dx={0} dy={0} blur={4} color={segment.color + '60'} />
                    </Line>
                  );
                })}
              </>
            );
          }

          // Fallback: single color line
          return (
            <Line points={points.y} color={color} strokeWidth={2.5} curveType="natural">
              <Shadow dx={0} dy={0} blur={5} color={color + '70'} />
            </Line>
          );
        }}
      </CartesianChart>
      {label && (
        <Text style={[styles.label, isDark ? styles.labelDark : styles.labelLight]}>{label}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  label: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    fontSize: 10,
    fontWeight: '500',
  },
  labelLight: {
    color: colors.textMuted,
  },
  labelDark: {
    color: darkColors.textMuted,
  },
});
