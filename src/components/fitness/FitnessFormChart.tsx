import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, Area, Bar } from 'victory-native';
import { LinearGradient, vec, Shadow, Rect } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { colors, spacing } from '@/theme';
import { calculateTSB, getFormZone, FORM_ZONE_COLORS } from '@/hooks';
import type { WellnessData } from '@/types';

// Chart colors matching intervals.icu
const COLORS = {
  fitness: '#42A5F5',    // Blue - CTL
  fatigue: '#AB47BC',    // Purple - ATL
  load: 'rgba(200, 100, 100, 0.6)', // Red dots for daily load
};

// Form zone backgrounds (matching intervals.icu)
const FORM_ZONES = {
  highRisk: { min: -Infinity, max: -30, color: 'rgba(239, 83, 80, 0.25)', label: 'High Risk' },
  optimal: { min: -30, max: -10, color: 'rgba(76, 175, 80, 0.25)', label: 'Optimal' },
  grey: { min: -10, max: 5, color: 'rgba(158, 158, 158, 0.15)', label: 'Grey Zone' },
  fresh: { min: 5, max: 25, color: 'rgba(129, 199, 132, 0.25)', label: 'Fresh' },
  transition: { min: 25, max: Infinity, color: 'rgba(100, 181, 246, 0.2)', label: 'Transition' },
};

// Get form line color based on current value
function getFormLineColor(form: number): string {
  if (form < -30) return '#EF5350'; // High Risk - Red
  if (form < -10) return '#66BB6A'; // Optimal - Green
  if (form < 5) return '#9E9E9E';   // Grey Zone - Grey
  if (form < 25) return '#81C784';  // Fresh - Light Green
  return '#64B5F6';                  // Transition - Blue
}

interface FitnessFormChartProps {
  data: WellnessData[];
  fitnessHeight?: number;
  formHeight?: number;
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

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function FitnessFormChart({
  data,
  fitnessHeight = 160,
  formHeight = 100,
  onDateSelect,
  onInteractionChange,
}: FitnessFormChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [tooltipData, setTooltipData] = useState<ChartDataPoint | null>(null);
  const [isActive, setIsActive] = useState(false);

  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  // Shared values for UI thread gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Process data for the chart
  const { chartData, maxLoad, maxFitness, minForm, maxForm } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], maxLoad: 50, maxFitness: 100, minForm: -30, maxForm: 30 };
    }

    const withTSB = calculateTSB(data);
    const points: ChartDataPoint[] = [];

    // Sort by date
    const sorted = [...withTSB].sort((a, b) => a.id.localeCompare(b.id));

    let maxL = 0;
    let maxF = 0;
    let minFm = 0;
    let maxFm = 0;

    sorted.forEach((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const form = fitness - fatigue;
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
    });

    return {
      chartData: points,
      maxLoad: Math.max(maxL, 50),
      maxFitness: Math.max(maxF, 50),
      minForm: Math.min(minFm, -35),
      maxForm: Math.max(maxFm, 30),
    };
  }, [data]);

  // Derive selected index on UI thread
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

  // Gesture handler
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
    .minDistance(0)
    .activateAfterLongPress(300);

  // Crosshair style
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const idx = selectedIdx.value;
    const coords = pointXCoordsShared.value;

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, []);

  if (chartData.length === 0) {
    return (
      <View style={[styles.placeholder, { height: fitnessHeight + formHeight }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>No fitness data available</Text>
      </View>
    );
  }

  // Get current (latest) values
  const currentData = chartData[chartData.length - 1];
  const displayData = tooltipData || currentData;
  const formZone = getFormZone(displayData.form);

  // Calculate form domain with padding
  const formDomain = { y: [Math.min(-35, minForm - 5), Math.max(30, maxForm + 5)] as [number, number] };

  return (
    <View style={styles.container}>
      {/* Header with date and values */}
      <View style={styles.header}>
        <Text style={[styles.dateText, isDark && styles.textLight]}>
          {isActive && tooltipData ? formatFullDate(tooltipData.date) : formatFullDate(currentData.date)}
        </Text>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textMuted]}>Fitness</Text>
            <Text style={[styles.valueNumber, { color: COLORS.fitness }]}>
              {Math.round(displayData.fitness)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textMuted]}>Fatigue</Text>
            <Text style={[styles.valueNumber, { color: COLORS.fatigue }]}>
              {Math.round(displayData.fatigue)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textMuted]}>Form</Text>
            <Text style={[styles.valueNumber, { color: FORM_ZONE_COLORS[formZone] }]}>
              {displayData.form > 0 ? '+' : ''}{Math.round(displayData.form)}
            </Text>
          </View>
        </View>
      </View>

      {/* Fitness/Fatigue Chart */}
      <GestureDetector gesture={gesture}>
        <View>
          <View style={[styles.chartWrapper, { height: fitnessHeight }]}>
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={['fitness', 'fatigue', 'load']}
              domain={{ y: [0, maxFitness * 1.15] }}
              padding={{ left: 0, right: 0, top: 8, bottom: 0 }}
            >
              {({ points, chartBounds }) => {
                // Sync chartBounds and point coordinates
                if (chartBounds.left !== chartBoundsShared.value.left ||
                    chartBounds.right !== chartBoundsShared.value.right) {
                  chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
                }
                const newCoords = points.fitness.map(p => p.x);
                if (newCoords.length !== pointXCoordsShared.value.length ||
                    newCoords[0] !== pointXCoordsShared.value[0]) {
                  pointXCoordsShared.value = newCoords;
                }

                return (
                  <>
                    {/* Fitness filled area */}
                    <Area
                      points={points.fitness}
                      y0={chartBounds.bottom}
                      curveType="natural"
                    >
                      <LinearGradient
                        start={vec(0, chartBounds.top)}
                        end={vec(0, chartBounds.bottom)}
                        colors={[COLORS.fitness + '60', COLORS.fitness + '10']}
                      />
                    </Area>

                    {/* Fitness line */}
                    <Line
                      points={points.fitness}
                      color={COLORS.fitness}
                      strokeWidth={2}
                      curveType="natural"
                    />

                    {/* Fatigue line */}
                    <Line
                      points={points.fatigue}
                      color={COLORS.fatigue}
                      strokeWidth={2}
                      curveType="natural"
                    />
                  </>
                );
              }}
            </CartesianChart>

            {/* Crosshair */}
            <Animated.View
              style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
              pointerEvents="none"
            />

            {/* Y-axis labels */}
            <View style={styles.yAxisOverlay} pointerEvents="none">
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {Math.round(maxFitness)}
              </Text>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                0
              </Text>
            </View>
          </View>

          {/* Form Chart with colored zones */}
          <View style={styles.formChartSection}>
            <Text style={[styles.formLabel, isDark && styles.textMuted]}>Form</Text>
            <View style={[styles.chartWrapper, { height: formHeight }]}>
              <CartesianChart
                data={chartData}
                xKey="x"
                yKeys={['form']}
                domain={formDomain}
                padding={{ left: 0, right: 0, top: 4, bottom: 16 }}
              >
                {({ points, chartBounds }) => {
                  const chartHeight = chartBounds.bottom - chartBounds.top;
                  const yRange = formDomain.y[1] - formDomain.y[0];

                  // Calculate zone positions
                  const getY = (val: number) => {
                    const ratio = (formDomain.y[1] - val) / yRange;
                    return chartBounds.top + ratio * chartHeight;
                  };

                  return (
                    <>
                      {/* Zone backgrounds */}
                      {/* High Risk zone (< -30) */}
                      <Rect
                        x={chartBounds.left}
                        y={getY(-30)}
                        width={chartBounds.right - chartBounds.left}
                        height={chartBounds.bottom - getY(-30)}
                        color={FORM_ZONES.highRisk.color}
                      />
                      {/* Optimal zone (-30 to -10) */}
                      <Rect
                        x={chartBounds.left}
                        y={getY(-10)}
                        width={chartBounds.right - chartBounds.left}
                        height={getY(-10) - getY(-30) > 0 ? getY(-30) - getY(-10) : 0}
                        color={FORM_ZONES.optimal.color}
                      />
                      {/* Grey zone (-10 to 5) */}
                      <Rect
                        x={chartBounds.left}
                        y={getY(5)}
                        width={chartBounds.right - chartBounds.left}
                        height={getY(-10) - getY(5)}
                        color={FORM_ZONES.grey.color}
                      />
                      {/* Fresh zone (5 to 25) */}
                      <Rect
                        x={chartBounds.left}
                        y={getY(25)}
                        width={chartBounds.right - chartBounds.left}
                        height={getY(5) - getY(25)}
                        color={FORM_ZONES.fresh.color}
                      />
                      {/* Transition zone (> 25) */}
                      <Rect
                        x={chartBounds.left}
                        y={chartBounds.top}
                        width={chartBounds.right - chartBounds.left}
                        height={getY(25) - chartBounds.top}
                        color={FORM_ZONES.transition.color}
                      />

                      {/* Zero line */}
                      <Rect
                        x={chartBounds.left}
                        y={getY(0) - 0.5}
                        width={chartBounds.right - chartBounds.left}
                        height={1}
                        color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}
                      />

                      {/* Form line - colored by zone */}
                      <Line
                        points={points.form}
                        color={getFormLineColor(displayData.form)}
                        strokeWidth={2.5}
                        curveType="natural"
                      >
                        <Shadow dx={0} dy={0} blur={4} color={getFormLineColor(displayData.form) + '60'} />
                      </Line>
                    </>
                  );
                }}
              </CartesianChart>

              {/* Crosshair for form chart */}
              <Animated.View
                style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                pointerEvents="none"
              />

              {/* Form zone labels on right */}
              <View style={styles.zoneLabels} pointerEvents="none">
                <Text style={[styles.zoneLabelText, { color: '#64B5F6' }]}>Transition</Text>
                <Text style={[styles.zoneLabelText, { color: '#81C784' }]}>Fresh</Text>
                <Text style={[styles.zoneLabelText, { color: '#9E9E9E' }]}>Grey Zone</Text>
                <Text style={[styles.zoneLabelText, { color: '#66BB6A' }]}>Optimal</Text>
                <Text style={[styles.zoneLabelText, { color: '#EF5350' }]}>High Risk</Text>
              </View>
            </View>
          </View>

          {/* X-axis labels */}
          <View style={styles.xAxisOverlay}>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {chartData.length > 0 ? formatDate(chartData[0].date) : ''}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {chartData.length > 0 ? formatDate(chartData[chartData.length - 1].date) : ''}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.fitness }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>Fitness</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.fatigue }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>Fatigue</Text>
        </View>
      </View>
    </View>
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
    fontSize: 13,
    color: colors.textSecondary,
  },
  textDark: {
    color: '#AAA',
  },
  textLight: {
    color: '#FFF',
  },
  textMuted: {
    color: '#888',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valuesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueItem: {
    alignItems: 'flex-end',
  },
  valueLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  valueNumber: {
    fontSize: 16,
    fontWeight: '700',
  },
  chartWrapper: {
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 4,
    bottom: 0,
    width: 1,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 8,
    bottom: 0,
    left: 4,
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: '#888',
  },
  formChartSection: {
    marginTop: spacing.xs,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  zoneLabels: {
    position: 'absolute',
    top: 4,
    bottom: 16,
    right: 4,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  zoneLabelText: {
    fontSize: 8,
    fontWeight: '500',
  },
  xAxisOverlay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 2,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
    marginRight: 6,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
});
