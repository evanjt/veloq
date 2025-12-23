import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, Area } from 'victory-native';
import { LinearGradient, vec, Shadow } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';
import { calculateTSB } from '@/hooks';
import type { WellnessData } from '@/types';


// Chart colors
const COLORS = {
  fitness: '#42A5F5', // Blue - CTL
  fatigue: '#AB47BC', // Purple - ATL
};

interface FitnessChartProps {
  data: WellnessData[];
  height?: number;
  selectedDate?: string | null;
  /** Shared value for instant crosshair sync between charts */
  sharedSelectedIdx?: SharedValue<number>;
  onDateSelect?: (date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => void;
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const FitnessChart = React.memo(function FitnessChart({ data, height = 200, selectedDate, sharedSelectedIdx, onDateSelect, onInteractionChange }: FitnessChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [tooltipData, setTooltipData] = useState<ChartDataPoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [visibleLines, setVisibleLines] = useState({
    fitness: true,
    fatigue: true,
  });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  // Shared values for UI thread gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);
  const externalSelectedIdx = useSharedValue(-1);

  const toggleLine = useCallback((line: 'fitness' | 'fatigue') => {
    setVisibleLines(prev => ({ ...prev, [line]: !prev[line] }));
  }, []);

  // Process data for the chart
  const { chartData, indexMap, maxLoad, maxFitness, minForm, maxForm } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], indexMap: [], maxLoad: 50, maxFitness: 100, minForm: -30, maxForm: 30 };
    }

    const withTSB = calculateTSB(data);
    const points: ChartDataPoint[] = [];
    const indices: number[] = [];

    // Sort by date
    const sorted = [...withTSB].sort((a, b) => a.id.localeCompare(b.id));

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
      const idx = chartData.findIndex(d => d.date === selectedDate);
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

  // Gesture handler on UI thread
  const gesture = Gesture.Pan()
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
    })
    .minDistance(0);

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
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>No fitness data available</Text>
      </View>
    );
  }

  // Get current (latest) values
  const currentData = chartData[chartData.length - 1];
  const displayData = tooltipData || currentData;

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with values */}
      <View style={styles.header}>
        <View style={styles.dateContainer}>
          <Text style={[styles.dateText, isDark && styles.textLight]}>
            {(isActive && tooltipData) || selectedDate ? formatDate(tooltipData?.date || selectedDate || '') : 'Current'}
          </Text>
        </View>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Fitness</Text>
            <Text style={[styles.valueNumber, { color: COLORS.fitness }]}>
              {Math.round(displayData.fitness)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Fatigue</Text>
            <Text style={[styles.valueNumber, { color: COLORS.fatigue }]}>
              {Math.round(displayData.fatigue)}
            </Text>
          </View>
        </View>
      </View>

      {/* Chart */}
      <GestureDetector gesture={gesture}>
        <View style={styles.chartWrapper}>
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['fitness', 'fatigue']}
            domain={{ y: [0, maxFitness * 1.1] }}
            padding={{ left: 0, right: 0, top: 8, bottom: 20 }}
          >
            {({ points, chartBounds }) => {
              // Sync chartBounds and point coordinates for UI thread crosshair
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
              }
              // Sync actual point x-coordinates for accurate crosshair positioning
              const newCoords = points.fitness.map(p => p.x);
              if (newCoords.length !== pointXCoordsShared.value.length ||
                  newCoords[0] !== pointXCoordsShared.value[0]) {
                pointXCoordsShared.value = newCoords;
              }

              return (
                <>
                  {/* Fitness area fill with gradient */}
                  {visibleLines.fitness && (
                    <Area
                      points={points.fitness}
                      y0={chartBounds.bottom}
                      curveType="natural"
                    >
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
          <Animated.View
            style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
            pointerEvents="none"
          />

          {/* X-axis labels */}
          <View style={styles.xAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {chartData.length > 0 ? formatDate(chartData[0].date) : ''}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {chartData.length > 0 ? formatDate(chartData[chartData.length - 1].date) : ''}
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
          <View style={[styles.legendDot, { backgroundColor: COLORS.fitness }, !visibleLines.fitness && styles.legendDotDisabled]} />
          <Text style={[styles.legendText, isDark && styles.textDark, !visibleLines.fitness && styles.legendTextDisabled]}>Fitness (CTL)</Text>
        </Pressable>
        <Pressable
          style={[styles.legendItem, !visibleLines.fatigue && styles.legendItemDisabled]}
          onPress={() => toggleLine('fatigue')}
          hitSlop={8}
        >
          <View style={[styles.legendDot, { backgroundColor: COLORS.fatigue }, !visibleLines.fatigue && styles.legendDotDisabled]} />
          <Text style={[styles.legendText, isDark && styles.textDark, !visibleLines.fatigue && styles.legendTextDisabled]}>Fatigue (ATL)</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: '#AAA',
  },
  textLight: {
    color: '#FFF',
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
    fontSize: 14,
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
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  valueNumber: {
    fontSize: 18,
    fontWeight: '700',
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 8,
    bottom: 20,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
  },
  axisLabelDark: {
    color: '#CCC',
    backgroundColor: 'rgba(30, 30, 30, 0.7)',
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
    fontSize: 11,
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
