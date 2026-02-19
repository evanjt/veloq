import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CartesianChart, Line, Area } from 'victory-native';
import { LinearGradient, vec, Shadow } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  SharedValue,
  useSharedValue,
  useAnimatedReaction,
  runOnJS,
  useDerivedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, darkColors, opacity, typography, spacing, layout, chartStyles } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { calculateTSB } from '@/hooks';
import { sortByDateId, formatShortDate } from '@/lib';
import { ChartErrorBoundary } from '@/components/ui';
import { ChartCrosshair } from '@/components/charts/base';
import type { WellnessData } from '@/types';

// Chart colors
const COLORS = {
  fitness: colors.fitness, // Blue - CTL
  fatigue: colors.chartPurple, // Purple - ATL
};

interface FitnessChartProps {
  data: WellnessData[];
  height?: number;
  selectedDate?: string | null;
  /** Shared value for instant crosshair sync between charts */
  sharedSelectedIdx?: SharedValue<number>;
  onDateSelect?: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
}

interface ChartDataPoint {
  x: number;
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
  load: number;
  [key: string]: string | number;
}

const CHART_PADDING = { left: 0, right: 0, top: 8, bottom: 20 } as const;

export const FitnessChart = React.memo(function FitnessChart({
  data,
  height = 200,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: FitnessChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [tooltipData, setTooltipData] = useState<ChartDataPoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [visibleLines, setVisibleLines] = useState({
    fitness: true,
    fatigue: true,
  });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  useEffect(() => {
    onDateSelectRef.current = onDateSelect;
    onInteractionChangeRef.current = onInteractionChange;
  }, [onDateSelect, onInteractionChange]);

  // Shared values for UI thread gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);
  const externalSelectedIdx = useSharedValue(-1);

  const toggleLine = useCallback((line: 'fitness' | 'fatigue') => {
    setVisibleLines((prev) => ({ ...prev, [line]: !prev[line] }));
  }, []);

  // Process data for the chart
  const { chartData, indexMap, maxLoad, maxFitness, minForm, maxForm } = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        chartData: [],
        indexMap: [],
        maxLoad: 50,
        maxFitness: 100,
        minForm: -30,
        maxForm: 30,
      };
    }

    const withTSB = calculateTSB(data);
    const points: ChartDataPoint[] = [];
    const indices: number[] = [];

    // Sort by date
    const sorted = sortByDateId(withTSB);

    let maxL = 0;
    let maxF = 0;
    let minFm = 0;
    let maxFm = 0;

    sorted.forEach((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      // Use rounded values for form calculation to match intervals.icu display
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const form = fitness - fatigue;
      // Estimate daily load from the difference in fatigue (rough approximation)
      const load = day.sportInfo?.reduce((sum, s) => sum + (s.load || 0), 0) || 0;

      maxL = Math.max(maxL, load);
      maxF = Math.max(maxF, fitness, fatigue);
      minFm = Math.min(minFm, form);
      maxFm = Math.max(maxFm, form);

      points.push({
        x: idx,
        date: day.id,
        fitness,
        fatigue,
        form,
        load,
      });
      indices.push(idx);
    });

    return {
      chartData: points,
      indexMap: indices,
      maxLoad: Math.max(maxL, 50),
      maxFitness: Math.max(maxF, 50),
      minForm: Math.min(minFm, -10),
      maxForm: Math.max(maxFm, 10),
    };
  }, [data]);

  // Sync with external selectedDate (from other chart)
  React.useEffect(() => {
    if (selectedDate && chartData.length > 0 && !isActive) {
      const idx = chartData.findIndex((d) => d.date === selectedDate);
      if (idx >= 0) {
        setTooltipData(chartData[idx]);
        externalSelectedIdx.value = idx;
      }
    } else if (!selectedDate && !isActive) {
      setTooltipData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  // Derive selected index on UI thread using chartBounds
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = chartData.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  // Bridge to JS for tooltip updates
  const updateTooltipOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setTooltipData(null);
          setIsActive(false);
          lastNotifiedIdx.current = null;
          if (onDateSelectRef.current) onDateSelectRef.current(null, null);
          if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
        }
        return;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) {
        setIsActive(true);
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
      }

      const point = chartData[idx];
      if (point) {
        setTooltipData(point);
        if (onDateSelectRef.current) {
          onDateSelectRef.current(point.date, {
            fitness: point.fitness,
            fatigue: point.fatigue,
            form: point.form,
          });
        }
      }
    },
    [chartData, isActive]
  );

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateTooltipOnJS)(idx);
    },
    [updateTooltipOnJS]
  );

  // Manual activation so the ScrollView can scroll freely during the long-press wait
  // (UNDETERMINED state doesn't claim the touch). A JS setTimeout handles the 200ms
  // timer so haptic + crosshair fire even when the finger is perfectly still.
  const gestureStartY = useSharedValue(0);
  const gestureInitialX = useSharedValue(0);
  const gestureReady = useSharedValue(false);
  const gestureActive = useSharedValue(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fireLongPress = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      touchX.value = gestureInitialX.value;
      gestureReady.value = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, CHART_CONFIG.LONG_PRESS_DURATION);
  }, [touchX, gestureInitialX, gestureReady]);
  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
    gestureReady.value = false;
  }, [gestureReady]);
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      'worklet';
      gestureStartY.value = e.allTouches[0].absoluteY;
      gestureInitialX.value = e.allTouches[0].x;
      gestureReady.value = false;
      gestureActive.value = false;
      runOnJS(fireLongPress)();
    })
    .onTouchesMove((e, mgr) => {
      'worklet';
      if (gestureActive.value) return;
      if (Math.abs(e.allTouches[0].absoluteY - gestureStartY.value) > 10) {
        runOnJS(cancelLongPress)();
        mgr.fail();
        return;
      }
      if (gestureReady.value) {
        gestureActive.value = true;
        mgr.activate();
      }
    })
    .onTouchesUp((_e, mgr) => {
      'worklet';
      if (gestureActive.value) return;
      runOnJS(cancelLongPress)();
      touchX.value = -1;
      mgr.fail();
    })
    .onStart((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
      gestureActive.value = false;
    });

  // Update shared selected index when local selection changes (for instant sync)
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (sharedSelectedIdx && idx >= 0) {
        sharedSelectedIdx.value = idx;
      }
    },
    [sharedSelectedIdx]
  );

  // Animated crosshair style - uses actual point coordinates for accuracy
  // Shows crosshair for either local touch, shared selection, or external selection
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const coords = pointXCoordsShared.value;
    // Priority: local touch > shared value > external selection
    let idx = selectedIdx.value;
    if (idx < 0 && sharedSelectedIdx) {
      idx = sharedSelectedIdx.value;
    }
    if (idx < 0) {
      idx = externalSelectedIdx.value;
    }

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, [sharedSelectedIdx]);

  if (chartData.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && chartStyles.textDark]}>
          {t('fitness.noData')}
        </Text>
      </View>
    );
  }

  // Get current (latest) values
  const currentData = chartData[chartData.length - 1];
  const displayData = tooltipData || currentData;

  return (
    <ChartErrorBoundary height={height} label="Fitness Chart">
      <View style={[styles.container, { height }]}>
        {/* Header with values */}
        <View style={styles.header}>
          <View style={styles.dateContainer}>
            <Text style={[styles.dateText, isDark && styles.textLight]}>
              {(isActive && tooltipData) || selectedDate
                ? formatShortDate(tooltipData?.date || selectedDate || '')
                : t('time.current')}
            </Text>
          </View>
          <View style={styles.valuesRow}>
            <View style={styles.valueItem}>
              <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
                {t('metrics.fitness')}
              </Text>
              <Text
                testID="fitness-ctl-value"
                style={[styles.valueNumber, { color: COLORS.fitness }]}
              >
                {Math.round(displayData.fitness)}
              </Text>
            </View>
            <View style={styles.valueItem}>
              <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
                {t('metrics.fatigue')}
              </Text>
              <Text
                testID="fitness-atl-value"
                style={[styles.valueNumber, { color: COLORS.fatigue }]}
              >
                {Math.round(displayData.fatigue)}
              </Text>
            </View>
          </View>
        </View>

        {/* Chart */}
        <GestureDetector gesture={gesture}>
          <View style={chartStyles.chartWrapper}>
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={['fitness', 'fatigue']}
              domain={{ y: [0, maxFitness * 1.1] }}
              padding={CHART_PADDING}
            >
              {({ points, chartBounds }) => {
                // Sync chartBounds and point coordinates for UI thread crosshair
                if (
                  chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right
                ) {
                  chartBoundsShared.value = {
                    left: chartBounds.left,
                    right: chartBounds.right,
                  };
                }
                // Sync actual point x-coordinates for accurate crosshair positioning
                // Guard before .map() to avoid allocating a temporary array every frame
                if (
                  points.fitness.length !== pointXCoordsShared.value.length ||
                  points.fitness[0]?.x !== pointXCoordsShared.value[0]
                ) {
                  pointXCoordsShared.value = points.fitness.map((p) => p.x);
                }

                return (
                  <>
                    {/* Fitness area fill with gradient */}
                    {visibleLines.fitness && (
                      <Area points={points.fitness} y0={chartBounds.bottom} curveType="natural">
                        <LinearGradient
                          start={vec(0, chartBounds.top)}
                          end={vec(0, chartBounds.bottom)}
                          colors={[COLORS.fitness + '40', COLORS.fitness + '05']}
                        />
                      </Area>
                    )}

                    {/* Fitness line (CTL) with glow effect */}
                    {visibleLines.fitness && (
                      <Line
                        points={points.fitness}
                        color={COLORS.fitness}
                        strokeWidth={3}
                        curveType="natural"
                      >
                        <Shadow dx={0} dy={0} blur={6} color={COLORS.fitness + '60'} />
                      </Line>
                    )}

                    {/* Fatigue line (ATL) */}
                    {visibleLines.fatigue && (
                      <Line
                        points={points.fatigue}
                        color={COLORS.fatigue}
                        strokeWidth={2.5}
                        curveType="natural"
                      >
                        <Shadow dx={0} dy={0} blur={4} color={COLORS.fatigue + '40'} />
                      </Line>
                    )}
                  </>
                );
              }}
            </CartesianChart>

            {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
            <ChartCrosshair style={crosshairStyle} topOffset={8} />

            {/* X-axis labels */}
            <View style={styles.xAxisOverlay} pointerEvents="none">
              <Text style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
                {chartData.length > 0 ? formatShortDate(chartData[0].date) : ''}
              </Text>
              <Text style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
                {chartData.length > 0 ? formatShortDate(chartData[chartData.length - 1].date) : ''}
              </Text>
            </View>
          </View>
        </GestureDetector>

        {/* Legend - pressable to toggle lines */}
        <View style={styles.legend}>
          <Pressable
            style={[styles.legendItem, !visibleLines.fitness && styles.legendItemDisabled]}
            onPress={() => toggleLine('fitness')}
            hitSlop={8}
          >
            <View
              style={[
                styles.legendDot,
                { backgroundColor: COLORS.fitness },
                !visibleLines.fitness && styles.legendDotDisabled,
              ]}
            />
            <Text
              style={[
                styles.legendText,
                isDark && chartStyles.textDark,
                !visibleLines.fitness && styles.legendTextDisabled,
              ]}
            >
              {t('fitness.fitnessCTL')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.legendItem, !visibleLines.fatigue && styles.legendItemDisabled]}
            onPress={() => toggleLine('fatigue')}
            hitSlop={8}
          >
            <View
              style={[
                styles.legendDot,
                { backgroundColor: COLORS.fatigue },
                !visibleLines.fatigue && styles.legendDotDisabled,
              ]}
            />
            <Text
              style={[
                styles.legendText,
                isDark && chartStyles.textDark,
                !visibleLines.fatigue && styles.legendTextDisabled,
              ]}
            >
              {t('fitness.fatigueATL')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {},
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  dateContainer: {
    flex: 1,
  },
  dateText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valuesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueItem: {
    alignItems: 'center',
  },
  valueLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  valueNumber: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  legendItemDisabled: {
    opacity: 0.5,
  },
  legendDotDisabled: {
    opacity: 0.4,
  },
  legendTextDisabled: {
    textDecorationLine: 'line-through',
  },
});
