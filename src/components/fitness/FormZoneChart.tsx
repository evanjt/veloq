import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, useChartPressState } from 'victory-native';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';
import { calculateTSB, getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, type FormZone } from '@/hooks';
import type { WellnessData } from '@/types';
import type { SharedValue } from 'react-native-reanimated';


// Zone boundaries (TSB values)
const ZONES = {
  transition: { min: 25, max: 50 },
  fresh: { min: 5, max: 25 },
  grey: { min: -10, max: 5 },
  optimal: { min: -30, max: -10 },
  highRisk: { min: -50, max: -30 },
};

interface FormZoneChartProps {
  data: WellnessData[];
  height?: number;
  onDateSelect?: (date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
}

interface ChartDataPoint {
  x: number;
  date: string;
  form: number;
  fitness: number;
  fatigue: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function FormZoneChart({ data, height = 100, onDateSelect, onInteractionChange }: FormZoneChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [selectedData, setSelectedData] = React.useState<ChartDataPoint | null>(null);
  const chartBoundsRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const { state, isActive } = useChartPressState({ x: 0, y: { form: 0 } });

  // Notify parent when interaction state changes
  useEffect(() => {
    if (onInteractionChangeRef.current) {
      onInteractionChangeRef.current(isActive);
    }
  }, [isActive]);

  // Process data for the chart
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const withTSB = calculateTSB(data);
    const sorted = [...withTSB].sort((a, b) => a.id.localeCompare(b.id));

    return sorted.map((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      // Use rounded values for form calculation to match intervals.icu display
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const form = fitness - fatigue;
      return {
        x: idx,
        date: day.id,
        form,
        fitness,
        fatigue,
      };
    });
  }, [data]);

  const handleDataLookup = useCallback(
    (xValue: number) => {
      if (chartData.length === 0) return;

      // xValue is the index from Victory - round to nearest integer
      const calculatedIndex = Math.max(0, Math.min(chartData.length - 1, Math.round(xValue)));

      const point = chartData[calculatedIndex];

      if (point) {
        setSelectedData(point);
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
    setSelectedData(null);
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
    return null;
  }

  // Calculate domain - show at least -35 to 30
  const minForm = Math.min(-35, ...chartData.map((d) => d.form));
  const maxForm = Math.max(30, ...chartData.map((d) => d.form));

  // Get current (latest) values for display when not selecting
  const currentData = chartData[chartData.length - 1];
  const displayData = selectedData || currentData;
  const formZone = getFormZone(displayData.form);

  return (
    <View style={styles.container}>
      {/* Header with values - always visible */}
      <View style={styles.header}>
        <View style={styles.dateContainer}>
          <Text style={[styles.dateText, isDark && styles.textLight]}>
            {isActive && selectedData ? formatDate(selectedData.date) : 'Current'}
          </Text>
        </View>
        <View style={styles.valuesRow}>
          <Text style={[styles.formValue, { color: FORM_ZONE_COLORS[formZone] }]}>
            {displayData.form > 0 ? '+' : ''}{displayData.form}
          </Text>
          <Text style={[styles.zoneText, { color: FORM_ZONE_COLORS[formZone] }]}>
            {FORM_ZONE_LABELS[formZone]}
          </Text>
        </View>
      </View>

      <View style={[styles.chartWrapper, { height }]}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['form']}
          domain={{ y: [minForm, maxForm] }}
          padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
          chartPressState={state}
          gestureLongPressDelay={50}
        >
          {({ points, chartBounds }) => {
            chartBoundsRef.current = chartBounds;
            const chartHeight = chartBounds.bottom - chartBounds.top;
            const yRange = maxForm - minForm;

            // Calculate zone rectangles
            const getZoneY = (value: number) => {
              const normalized = (maxForm - value) / yRange;
              return chartBounds.top + normalized * chartHeight;
            };

            return (
              <>
                {/* Zone backgrounds */}
                <ZoneBackground
                  bounds={chartBounds}
                  minY={getZoneY(ZONES.transition.max)}
                  maxY={getZoneY(ZONES.transition.min)}
                  color={FORM_ZONE_COLORS.transition + '30'}
                />
                <ZoneBackground
                  bounds={chartBounds}
                  minY={getZoneY(ZONES.fresh.max)}
                  maxY={getZoneY(ZONES.fresh.min)}
                  color={FORM_ZONE_COLORS.fresh + '30'}
                />
                <ZoneBackground
                  bounds={chartBounds}
                  minY={getZoneY(ZONES.grey.max)}
                  maxY={getZoneY(ZONES.grey.min)}
                  color={FORM_ZONE_COLORS.grey + '20'}
                />
                <ZoneBackground
                  bounds={chartBounds}
                  minY={getZoneY(ZONES.optimal.max)}
                  maxY={getZoneY(ZONES.optimal.min)}
                  color={FORM_ZONE_COLORS.optimal + '30'}
                />
                <ZoneBackground
                  bounds={chartBounds}
                  minY={getZoneY(ZONES.highRisk.max)}
                  maxY={getZoneY(ZONES.highRisk.min)}
                  color={FORM_ZONE_COLORS.highRisk + '30'}
                />

                {/* Zero line */}
                <SkiaLine
                  p1={vec(chartBounds.left, getZoneY(0))}
                  p2={vec(chartBounds.right, getZoneY(0))}
                  color={isDark ? '#555' : '#CCC'}
                  strokeWidth={1}
                  style="stroke"
                />

                {/* Form line */}
                <Line
                  points={points.form}
                  color={isDark ? '#FFFFFF' : '#333333'}
                  strokeWidth={2}
                  curveType="natural"
                />

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

        {/* Y-axis labels */}
        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(maxForm)}</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>0</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(minForm)}</Text>
        </View>
      </View>

      {/* Zone legend */}
      <View style={styles.zoneLegend}>
        {(['transition', 'fresh', 'grey', 'optimal', 'highRisk'] as FormZone[]).map((zone) => (
          <View key={zone} style={styles.zoneLegendItem}>
            <View style={[styles.zoneDot, { backgroundColor: FORM_ZONE_COLORS[zone] }]} />
            <Text style={[styles.zoneLabel, isDark && styles.textDark]}>{FORM_ZONE_LABELS[zone]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ZoneBackground({
  bounds,
  minY,
  maxY,
  color,
}: {
  bounds: { left: number; right: number };
  minY: number;
  maxY: number;
  color: string;
}) {
  const height = maxY - minY;
  if (height <= 0) return null;

  return (
    <Rect
      x={bounds.left}
      y={minY}
      width={bounds.right - bounds.left}
      height={height}
      color={color}
    />
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
  textLight: {
    color: '#FFFFFF',
  },
  valuesRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  formValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  zoneText: {
    fontSize: 12,
    fontWeight: '500',
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 2,
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
  },
  axisLabelDark: {
    color: '#CCC',
    backgroundColor: 'rgba(30, 30, 30, 0.7)',
  },
  zoneLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  zoneLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 3,
  },
  zoneLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  textDark: {
    color: '#AAA',
  },
});
