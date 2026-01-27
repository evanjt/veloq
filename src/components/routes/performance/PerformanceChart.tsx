/**
 * Performance chart for route/section analysis.
 * Shows speed/pace over time with interactive scrubbing.
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedRef,
  runOnJS,
} from 'react-native-reanimated';
import { colors, darkColors, spacing, typography } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import type { RoutePerformancePoint } from '@/hooks/routes/useRoutePerformances';
import { formatShortDate as formatShortDateLib } from '@/lib';

// Direction colors
const SAME_COLOR = colors.sameDirection;
const REVERSE_COLOR = colors.reverseDirection;

const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40;
const SCREEN_WIDTH = Dimensions.get('window').width;

interface ChartDataPoint {
  x: number;
  speed: number;
  date: Date;
  name: string;
  isCurrent: boolean;
  isBest: boolean;
  activityId: string;
  direction: string;
}

interface PerformanceChartProps {
  performances: RoutePerformancePoint[];
  bestActivityId: string | undefined;
  isDark: boolean;
  formatSpeedValue: (speed: number) => string;
  currentActivityColor: string;
  onTooltipUpdate: (point: RoutePerformancePoint | null, isPersisted: boolean) => void;
}

function formatShortDate(date: Date): string {
  return formatShortDateLib(date);
}

export function PerformanceChart({
  performances,
  bestActivityId,
  isDark,
  formatSpeedValue,
  currentActivityColor,
  onTooltipUpdate,
}: PerformanceChartProps) {
  // Gesture tracking
  const touchX = useSharedValue(-1);
  const scrollOffsetX = useSharedValue(0);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  const isPersistedRef = useRef(false);
  const scrollViewRef = useAnimatedRef<Animated.ScrollView>();

  // Prepare chart data
  const chartData = useMemo(() => {
    return performances.map((p, idx) => ({
      x: idx,
      speed: p.speed,
      date: p.date,
      name: p.name,
      isCurrent: p.isCurrent,
      isBest: bestActivityId === p.activityId,
      activityId: p.activityId,
      direction: p.direction,
    }));
  }, [performances, bestActivityId]);

  // Calculate chart width
  const chartWidth = useMemo(() => {
    const containerWidth = SCREEN_WIDTH - spacing.md * 2;
    const minWidth = chartData.length * MIN_POINT_WIDTH;
    return Math.max(containerWidth, minWidth);
  }, [chartData.length]);

  const needsScroll = chartWidth > SCREEN_WIDTH - spacing.md * 2;

  // Find indices and domain
  const { currentIndex, bestIndex, minSpeed, maxSpeed } = useMemo(() => {
    const currIdx = chartData.findIndex((d) => d.isCurrent);
    const bestIdx = chartData.findIndex((d) => d.isBest);
    const speeds = chartData.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;
    return {
      currentIndex: currIdx,
      bestIndex: bestIdx,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
    };
  }, [chartData]);

  // Derive selected index on UI thread
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = chartData.length;
    const bounds = chartBoundsShared.value;
    const chartW = bounds.right - bounds.left;

    if (touchX.value < 0 || chartW <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartW));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  // Update tooltip on JS thread
  const updateTooltipOnJS = useCallback(
    (idx: number, gestureEnded = false) => {
      if (gestureEnded) {
        if (isActiveRef.current && lastNotifiedIdx.current !== null) {
          isActiveRef.current = false;
          isPersistedRef.current = true;
          const point = performances[lastNotifiedIdx.current];
          if (point) {
            onTooltipUpdate(point, true);
          }
        }
        lastNotifiedIdx.current = null;
        return;
      }

      if (idx < 0 || performances.length === 0) {
        return;
      }

      if (isPersistedRef.current) {
        isPersistedRef.current = false;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActiveRef.current) {
        isActiveRef.current = true;
      }

      const point = performances[idx];
      if (point) {
        onTooltipUpdate(point, false);
      }
    },
    [performances, onTooltipUpdate]
  );

  const handleGestureEnd = useCallback(() => {
    updateTooltipOnJS(-1, true);
  }, [updateTooltipOnJS]);

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (idx >= 0) {
        runOnJS(updateTooltipOnJS)(idx, false);
      }
    },
    [updateTooltipOnJS]
  );

  const clearPersistedTooltip = useCallback(() => {
    if (isPersistedRef.current) {
      isPersistedRef.current = false;
      onTooltipUpdate(null, false);
    }
  }, [onTooltipUpdate]);

  // Track scroll position for accurate scrubbing - runs on UI thread
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollOffsetX.value = event.contentOffset.x;
    },
  });

  // Gesture handlers - pan with long press, accounting for scroll offset
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION)
    .onStart((e) => {
      'worklet';
      touchX.value = e.x + scrollOffsetX.value;
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x + scrollOffsetX.value;
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
      runOnJS(handleGestureEnd)();
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(clearPersistedTooltip)();
  });

  // Simultaneous: both gestures can work - tap for quick dismiss, pan after long press
  const gesture = Gesture.Simultaneous(tapGesture, panGesture);

  // Animated crosshair
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const coords = pointXCoordsShared.value;
    const idx = selectedIdx.value;

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, []);

  if (chartData.length <= 1) {
    return null;
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.chartScrollContainer}>
        <Animated.ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={needsScroll}
          scrollEnabled={needsScroll}
          contentContainerStyle={{ width: chartWidth }}
          onScroll={handleScroll}
          scrollEventThrottle={8}
        >
          <View style={[styles.chartContainer, { width: chartWidth }]}>
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={['speed']}
              domain={{ y: [minSpeed, maxSpeed] }}
              padding={{ left: 35, right: 8, top: 40, bottom: 24 }}
            >
              {({ points, chartBounds }) => {
                // Sync chartBounds for gesture handling
                if (
                  chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right
                ) {
                  chartBoundsShared.value = {
                    left: chartBounds.left,
                    right: chartBounds.right,
                  };
                }
                // Sync point x-coordinates
                const newCoords = points.speed.map((p) => p.x ?? 0);
                if (newCoords.length !== pointXCoordsShared.value.length) {
                  pointXCoordsShared.value = newCoords;
                }

                return (
                  <>
                    <Line
                      points={points.speed}
                      color={isDark ? '#444' : '#DDD'}
                      strokeWidth={1.5}
                      curveType="monotoneX"
                    />
                    {points.speed.map((point, idx) => {
                      if (point.x == null || point.y == null) return null;
                      const d = chartData[idx];
                      if (d?.isBest || d?.isCurrent) return null;
                      const pointColor = d?.direction === 'reverse' ? REVERSE_COLOR : SAME_COLOR;
                      return (
                        <Circle
                          key={`point-${idx}`}
                          cx={point.x}
                          cy={point.y}
                          r={5}
                          color={pointColor}
                        />
                      );
                    })}
                    {bestIndex >= 0 &&
                      points.speed[bestIndex] &&
                      points.speed[bestIndex].x != null &&
                      points.speed[bestIndex].y != null && (
                        <>
                          <Circle
                            cx={points.speed[bestIndex].x!}
                            cy={points.speed[bestIndex].y!}
                            r={8}
                            color="#FFB300"
                          />
                          <Circle
                            cx={points.speed[bestIndex].x!}
                            cy={points.speed[bestIndex].y!}
                            r={4}
                            color="#FFFFFF"
                          />
                        </>
                      )}
                    {currentIndex >= 0 &&
                      currentIndex !== bestIndex &&
                      points.speed[currentIndex] &&
                      points.speed[currentIndex].x != null &&
                      points.speed[currentIndex].y != null && (
                        <>
                          <Circle
                            cx={points.speed[currentIndex].x!}
                            cy={points.speed[currentIndex].y!}
                            r={8}
                            color={currentActivityColor}
                            opacity={0.3}
                          />
                          <Circle
                            cx={points.speed[currentIndex].x!}
                            cy={points.speed[currentIndex].y!}
                            r={5}
                            color={currentActivityColor}
                          />
                        </>
                      )}
                  </>
                );
              }}
            </CartesianChart>

            <Animated.View
              style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
              pointerEvents="none"
            />

            <View style={styles.yAxisOverlay} pointerEvents="none">
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatSpeedValue(maxSpeed)}
              </Text>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatSpeedValue((minSpeed + maxSpeed) / 2)}
              </Text>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatSpeedValue(minSpeed)}
              </Text>
            </View>

            <View style={styles.xAxisOverlay} pointerEvents="none">
              {chartData.length > 0 && (
                <>
                  <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                    {formatShortDate(chartData[0].date)}
                  </Text>
                  {chartData.length >= 5 && (
                    <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                      {formatShortDate(chartData[Math.floor(chartData.length / 2)].date)}
                    </Text>
                  )}
                  <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                    {formatShortDate(chartData[chartData.length - 1].date)}
                  </Text>
                </>
              )}
            </View>
          </View>
        </Animated.ScrollView>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  chartScrollContainer: {
    maxHeight: CHART_HEIGHT,
  },
  chartContainer: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    width: 1.5,
    backgroundColor: colors.textSecondary,
  },
  crosshairDark: {
    backgroundColor: darkColors.textSecondary,
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    left: spacing.xs,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: spacing.xs,
    left: 35,
    right: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
});
