import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { colors, darkColors, opacity, typography, spacing, layout } from '@/theme';
import { calculateTSB, getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, FORM_ZONE_BOUNDARIES, type FormZone } from '@/hooks';
import type { WellnessData } from '@/types';

interface FormZoneChartProps {
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
  form: number;
  fitness: number;
  fatigue: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const FormZoneChart = React.memo(function FormZoneChart({ data, height = 100, selectedDate, sharedSelectedIdx, onDateSelect, onInteractionChange }: FormZoneChartProps) {
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
  const externalSelectedIdx = useSharedValue(-1);

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

  // Sync with external selectedDate (from other chart)
  React.useEffect(() => {
    if (selectedDate && chartData.length > 0 && !isActive) {
      const idx = chartData.findIndex(d => d.date === selectedDate);
      if (idx >= 0) {
        setSelectedData(chartData[idx]);
        externalSelectedIdx.value = idx;
      }
    } else if (!selectedDate && !isActive) {
      setSelectedData(null);
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
    .minDistance(0)
    .activateAfterLongPress(700);

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
            {(isActive && selectedData) || selectedDate ? formatDate(selectedData?.date || selectedDate || '') : 'Current'}
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
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.transition.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.transition.min)}
                    color={FORM_ZONE_COLORS.transition + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.fresh.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.fresh.min)}
                    color={FORM_ZONE_COLORS.fresh + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.grey.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.grey.min)}
                    color={FORM_ZONE_COLORS.grey + '20'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.optimal.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.optimal.min)}
                    color={FORM_ZONE_COLORS.optimal + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.highRisk.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.highRisk.min)}
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
});

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
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
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
    fontSize: typography.caption.fontSize,
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
    backgroundColor: colors.textSecondary,
  },
  crosshairDark: {
    backgroundColor: darkColors.textSecondary,
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
    color: darkColors.textPrimary,
    backgroundColor: darkColors.surfaceOverlay,
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
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
