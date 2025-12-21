import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, Bar, Area, useChartPressState } from 'victory-native';
import { Circle, Line as SkiaLine, LinearGradient, vec, Shadow } from '@shopify/react-native-skia';
import { useDerivedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';
import { calculateTSB, getFormZone, FORM_ZONE_COLORS } from '@/hooks';
import type { WellnessData } from '@/types';
import type { SharedValue } from 'react-native-reanimated';


// Chart colors
const COLORS = {
  fitness: '#42A5F5', // Blue - CTL
  fatigue: '#AB47BC', // Purple - ATL
  form: '#66BB6A',    // Green - TSB
  load: 'rgba(150, 150, 150, 0.5)', // Grey bars for daily load
};

interface FitnessChartProps {
  data: WellnessData[];
  height?: number;
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
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function FitnessChart({ data, height = 200, onDateSelect, onInteractionChange }: FitnessChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [tooltipData, setTooltipData] = React.useState<ChartDataPoint | null>(null);
  const [visibleLines, setVisibleLines] = React.useState({
    fitness: true,
    fatigue: true,
    form: true,
  });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;
  const chartBoundsRef = useRef({ left: 0, right: 0 });

  const toggleLine = useCallback((line: 'fitness' | 'fatigue' | 'form') => {
    setVisibleLines(prev => ({ ...prev, [line]: !prev[line] }));
  }, []);

  const { state, isActive } = useChartPressState({ x: 0, y: { fitness: 0 } });

  // Notify parent when interaction state changes
  useEffect(() => {
    if (onInteractionChangeRef.current) {
      onInteractionChangeRef.current(isActive);
    }
  }, [isActive]);

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

  const handleDataLookup = useCallback(
    (xValue: number) => {
      if (chartData.length === 0) return;

      // xValue is the index from Victory - round to nearest integer
      const calculatedIndex = Math.max(0, Math.min(chartData.length - 1, Math.round(xValue)));
      const point = chartData[calculatedIndex];

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
    [chartData]
  );

  const handleClearSelection = useCallback(() => {
    setTooltipData(null);
    if (onDateSelectRef.current) {
      onDateSelectRef.current(null, null);
    }
  }, []);

  useAnimatedReaction(
    () => ({
      xValue: state.x.value.value,
      active: isActive,
    }),
    (current) => {
      if (current.active) {
        runOnJS(handleDataLookup)(current.xValue);
      } else {
        runOnJS(handleClearSelection)();
      }
    },
    [isActive, handleDataLookup, handleClearSelection]
  );

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
  const formZone = getFormZone(displayData.form);

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with values */}
      <View style={styles.header}>
        <View style={styles.dateContainer}>
          <Text style={[styles.dateText, isDark && styles.textLight]}>
            {isActive && tooltipData ? formatDate(tooltipData.date) : 'Current'}
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
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Form</Text>
            <Text style={[styles.valueNumber, { color: FORM_ZONE_COLORS[formZone] }]}>
              {displayData.form > 0 ? '+' : ''}{Math.round(displayData.form)}
            </Text>
          </View>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['fitness', 'fatigue', 'form']}
          domain={{ y: [Math.min(0, minForm * 1.1), maxFitness * 1.1] }}
          padding={{ left: 0, right: 0, top: 8, bottom: 20 }}
          chartPressState={state}
          gestureLongPressDelay={50}
        >
          {({ points, chartBounds }) => {
            chartBoundsRef.current = { left: chartBounds.left, right: chartBounds.right };

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

                {/* Form line (TSB) - drawn first so it's behind */}
                {visibleLines.form && (
                  <Line
                    points={points.form}
                    color={COLORS.form}
                    strokeWidth={2.5}
                    curveType="natural"
                  />
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

                {/* Crosshair when active */}
                {isActive && (
                  <ActiveCrosshair
                    xPosition={state.x.position}
                    top={chartBounds.top}
                    bottom={chartBounds.bottom}
                    left={chartBounds.left}
                    right={chartBounds.right}
                    isDark={isDark}
                  />
                )}
              </>
            );
          }}
        </CartesianChart>

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
        <Pressable
          style={[styles.legendItem, !visibleLines.form && styles.legendItemDisabled]}
          onPress={() => toggleLine('form')}
          hitSlop={8}
        >
          <View style={[styles.legendDot, { backgroundColor: COLORS.form }, !visibleLines.form && styles.legendDotDisabled]} />
          <Text style={[styles.legendText, isDark && styles.textDark, !visibleLines.form && styles.legendTextDisabled]}>Form (TSB)</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActiveCrosshair({
  xPosition,
  top,
  bottom,
  left,
  right,
  isDark,
}: {
  xPosition: SharedValue<number>;
  top: number;
  bottom: number;
  left: number;
  right: number;
  isDark: boolean;
}) {
  // Use raw position for crosshair
  const clampedX = useDerivedValue(() => Math.max(left, Math.min(right, xPosition.value)));
  const lineStart = useDerivedValue(() => vec(clampedX.value, top));
  const lineEnd = useDerivedValue(() => vec(clampedX.value, bottom));

  return (
    <SkiaLine
      p1={lineStart}
      p2={lineEnd}
      color={isDark ? '#888' : '#666'}
      strokeWidth={1.5}
      style="stroke"
    />
  );
}

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
