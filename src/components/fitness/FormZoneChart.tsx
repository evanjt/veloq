import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';
import { calculateTSB, getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, type FormZone } from '@/hooks';
import type { WellnessData } from '@/types';


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
  const [selectedData, setSelectedData] = useState<ChartDataPoint | null>(null);
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
          setSelectedData(null);
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

  // Animated crosshair style - uses actual point coordinates for accuracy
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

      <GestureDetector gesture={gesture}>
        <View style={[styles.chartWrapper, { height }]}>
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['form']}
            domain={{ y: [minForm, maxForm] }}
            padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
          >
            {({ points, chartBounds }) => {
              // Sync chartBounds and point coordinates for UI thread crosshair
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
              }
              // Sync actual point x-coordinates for accurate crosshair positioning
              const newCoords = points.form.map(p => p.x);
              if (newCoords.length !== pointXCoordsShared.value.length ||
                  newCoords[0] !== pointXCoordsShared.value[0]) {
                pointXCoordsShared.value = newCoords;
              }

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
                </>
              );
            }}
          </CartesianChart>

          {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
          <Animated.View
            style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
            pointerEvents="none"
          />

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(maxForm)}</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>0</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(minForm)}</Text>
          </View>
        </View>
      </GestureDetector>

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
  crosshair: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
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
