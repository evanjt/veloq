import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, type PointsArray } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';

import type { LaneData } from '@/features/routes/lib/unifiedPerformanceData';
import type { PerformanceDataPoint } from '@/types';
import { colors, chartStyles } from '@/theme';
import { styles } from './unifiedPerformanceChart.styles';
import type { UnifiedChartLayout } from './useUnifiedChartLayout';

const CHART_PADDING = { left: 40, right: 20, top: 16, bottom: 12 } as const;
const CHART_PADDING_LEFT = 40;
const CHART_PADDING_RIGHT = 20;

type LanePoint = LaneData['points'][number];

interface PerformanceLaneChartProps {
  lane: LaneData;
  color: string;
  selectedPoint: (PerformanceDataPoint & { x: number }) | null;
  chartWidth: number;
  chartContentWidth: number;
  gaps: UnifiedChartLayout['gaps'];
  isDark: boolean;
  onPointPress: (point: LanePoint) => void;
  formatSpeedValue: (speed: number) => string;
}

export function PerformanceLaneChart({
  lane,
  color,
  selectedPoint,
  chartWidth,
  chartContentWidth,
  gaps,
  isDark,
  onPointPress,
  formatSpeedValue,
}: PerformanceLaneChartProps) {
  if (lane.points.length === 0) return null;

  const selectedLaneIdx = selectedPoint
    ? lane.points.findIndex((p) => p.activityId === selectedPoint.activityId)
    : -1;

  return (
    <View style={chartStyles.chartWrapper}>
      <View style={StyleSheet.absoluteFill}>
        <CartesianChart
          data={lane.points as unknown as Record<string, unknown>[]}
          xKey={'x' as never}
          yKeys={['speed'] as never}
          domain={{
            x: [0, 1],
            y: [lane.minSpeed, lane.maxSpeed],
          }}
          padding={CHART_PADDING}
        >
          {
            (({ points }: { points: { speed: PointsArray } }) => (
              <>
                {points.speed.map((point: PointsArray[number], idx: number) => {
                  if (point.x == null || point.y == null) return null;
                  const isBest = idx === lane.bestIndex;
                  const isCurrent = idx === lane.currentIndex;
                  const isSelected = idx === selectedLaneIdx;

                  if (isSelected) {
                    return (
                      <React.Fragment key={`point-${idx}`}>
                        <Circle cx={point.x} cy={point.y} r={8} color={colors.chartCyan} />
                        <Circle cx={point.x} cy={point.y} r={5} color={color} />
                      </React.Fragment>
                    );
                  }

                  if (isBest && !isCurrent) {
                    return (
                      <React.Fragment key={`point-${idx}`}>
                        <Circle cx={point.x} cy={point.y} r={8} color={colors.chartGold} />
                        <Circle cx={point.x} cy={point.y} r={5} color={color} />
                      </React.Fragment>
                    );
                  }

                  if (isCurrent) {
                    return (
                      <React.Fragment key={`point-${idx}`}>
                        <Circle cx={point.x} cy={point.y} r={9} color={colors.chartCyan} />
                        <Circle cx={point.x} cy={point.y} r={5} color={color} />
                      </React.Fragment>
                    );
                  }

                  return (
                    <Circle key={`point-${idx}`} cx={point.x} cy={point.y} r={5} color={color} />
                  );
                })}
              </>
            )) as any
          }
        </CartesianChart>
      </View>

      {/* Single tap target — finds nearest point by X coordinate */}
      <Pressable
        style={styles.tapTargetContainer}
        onPress={(e) => {
          const tapX = e.nativeEvent.locationX - CHART_PADDING_LEFT;
          const normalizedX = Math.max(0, Math.min(1, tapX / chartContentWidth));
          let closest = lane.points[0];
          let closestDist = Infinity;
          for (const pt of lane.points) {
            const dist = Math.abs(pt.x - normalizedX);
            if (dist < closestDist) {
              closestDist = dist;
              closest = pt;
            }
          }
          if (closest) onPointPress(closest);
        }}
      />

      <View style={styles.yAxisOverlay} pointerEvents="none">
        <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
          {formatSpeedValue(lane.maxSpeed)}
        </Text>
        <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
          {formatSpeedValue(lane.minSpeed)}
        </Text>
      </View>

      {/* Gap indicators - show edges and fill when expanded */}
      {gaps.length > 0 && (
        <View style={styles.gapLinesOverlay} pointerEvents="none">
          {gaps.map((gap, idx) => {
            const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
            const startPixelX = CHART_PADDING_LEFT + gap.startX * chartContentW;
            const endPixelX = CHART_PADDING_LEFT + gap.endX * chartContentW;

            if (gap.isExpanded) {
              const lineColor = isDark ? '#666666' : '#999999';
              return (
                <View key={`gap-expanded-${idx}`}>
                  <View
                    style={[styles.gapEdgeLine, { left: startPixelX, backgroundColor: lineColor }]}
                  />
                  <View
                    style={[styles.gapEdgeLine, { left: endPixelX, backgroundColor: lineColor }]}
                  />
                </View>
              );
            }

            const pixelX = CHART_PADDING_LEFT + gap.xPosition * chartContentW + 4;
            return (
              <View
                key={`gap-line-${idx}`}
                style={[
                  styles.gapVerticalLine,
                  isDark && styles.gapVerticalLineDark,
                  { left: pixelX },
                ]}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}
