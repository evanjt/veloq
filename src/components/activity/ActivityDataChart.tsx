import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Area } from 'victory-native';
import { LinearGradient, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { colors, typography } from '@/theme';
import { useMetricSystem } from '@/hooks';


interface ActivityDataChartProps {
  /** The metric values to display */
  data: number[];
  /** Distance values for X-axis (in meters) */
  distance: number[];
  /** Chart height in pixels */
  height?: number;
  /** Label for the metric (e.g., "Heart Rate") */
  label: string;
  /** Unit for the metric (e.g., "bpm") */
  unit: string;
  /** Chart color for gradient */
  color: string;
  /** Custom value formatter */
  formatValue?: (value: number, isMetric: boolean) => string;
  /** Convert value to imperial units */
  convertToImperial?: (value: number) => number;
  /** Called when user selects a point - returns the original data index */
  onPointSelect?: (index: number | null) => void;
  /** Called when interaction starts/ends - use to disable parent ScrollView */
  onInteractionChange?: (isInteracting: boolean) => void;
}

export function ActivityDataChart({
  data: rawData = [],
  distance = [],
  height = 150,
  label,
  unit,
  color: chartColor,
  formatValue,
  convertToImperial,
  onPointSelect,
  onInteractionChange,
}: ActivityDataChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isMetric = useMetricSystem();

  // Shared values for UI thread gesture tracking (native 120Hz performance)
  const touchX = useSharedValue(-1);
  const xValuesShared = useSharedValue<number[]>([]);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  // Store Victory Native's actual rendered x-coordinates for smooth crosshair
  const pointXCoordsShared = useSharedValue<number[]>([]);

  // React state for tooltip
  const [tooltipData, setTooltipData] = useState<{ x: number; y: number } | null>(null);
  const [isActive, setIsActive] = useState(false);

  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const isActiveRef = useRef(false);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const lastNotifiedIdx = useRef<number | null>(null);

  // Build chart data with downsampling
  const { data, indexMap } = useMemo(() => {
    if (rawData.length === 0) return { data: [], indexMap: [] as number[] };

    const maxPoints = 200;
    const step = Math.max(1, Math.floor(rawData.length / maxPoints));

    const points: { x: number; y: number; idx: number }[] = [];
    const indices: number[] = [];

    for (let i = 0; i < rawData.length; i += step) {
      // X-axis: distance in km or mi
      const distKm = distance.length > i ? distance[i] / 1000 : i * 0.01;
      const xValue = isMetric ? distKm : distKm * 0.621371;

      // Y-axis: apply imperial conversion if needed
      let yValue = rawData[i];
      if (!isMetric && convertToImperial) {
        yValue = convertToImperial(yValue);
      }

      points.push({ x: xValue, y: yValue, idx: i });
      indices.push(i);
    }
    return { data: points, indexMap: indices };
  }, [rawData, distance, isMetric, convertToImperial]);

  const { minVal, maxVal, maxDist } = useMemo(() => {
    if (data.length === 0) {
      return { minVal: 0, maxVal: 100, maxDist: 1 };
    }
    const values = data.map((d) => d.y);
    const distances = data.map((d) => d.x);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 10;
    return {
      minVal: Math.floor(min - padding),
      maxVal: Math.ceil(max + padding),
      maxDist: Math.max(...distances),
    };
  }, [data]);

  // Sync x-values to shared value for UI thread access
  React.useEffect(() => {
    xValuesShared.value = data.map(d => d.x);
  }, [data, xValuesShared]);

  // Derive selected index on UI thread using chartBounds
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = xValuesShared.value.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, []);

  // Bridge to JS for tooltip updates
  const updateTooltipOnJS = useCallback((idx: number) => {
    if (idx < 0 || data.length === 0) {
      if (lastNotifiedIdx.current !== null) {
        setTooltipData(null);
        setIsActive(false);
        isActiveRef.current = false;
        lastNotifiedIdx.current = null;
        if (onPointSelectRef.current) onPointSelectRef.current(null);
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
      }
      return;
    }

    if (idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;

    if (!isActiveRef.current) {
      setIsActive(true);
      isActiveRef.current = true;
      if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
    }

    const point = data[idx];
    if (point) {
      setTooltipData({ x: point.x, y: point.y });
    }

    if (onPointSelectRef.current && idx < indexMap.length) {
      onPointSelectRef.current(indexMap[idx]);
    }
  }, [data, indexMap]);

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

  // Animated crosshair style - follows finger directly for smooth tracking
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    // Use touchX directly so crosshair always follows the finger exactly
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    // Clamp to chart bounds
    const bounds = chartBoundsShared.value;
    const xPos = Math.max(bounds.left, Math.min(bounds.right, touchX.value));

    return {
      opacity: 1,
      transform: [{ translateX: xPos }],
    };
  }, []);

  const distanceUnit = isMetric ? 'km' : 'mi';

  // Format the display value
  const formatDisplayValue = (value: number): string => {
    if (formatValue) {
      return formatValue(value, isMetric);
    }
    return Math.round(value).toString();
  };

  if (data.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>No {label.toLowerCase()} data</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.chartWrapper}>
          {/* Tooltip display */}
          {isActive && tooltipData && (
            <View style={[styles.tooltip, isDark && styles.tooltipDark]} pointerEvents="none">
              <Text style={[styles.tooltipText, isDark && styles.tooltipTextDark]}>
                {tooltipData.x.toFixed(2)} {distanceUnit}  •  {formatDisplayValue(tooltipData.y)} {unit}
              </Text>
            </View>
          )}

          <CartesianChart
            data={data}
            xKey="x"
            yKeys={['y']}
            domain={{ y: [minVal, maxVal] }}
            padding={{ left: 0, right: 0, top: 4, bottom: 16 }}
          >
            {({ points, chartBounds }) => {
              // Sync chartBounds and point coordinates for UI thread crosshair
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
              }
              // Sync actual point x-coordinates for accurate crosshair positioning
              const newCoords = points.y.map(p => p.x);
              if (newCoords.length !== pointXCoordsShared.value.length ||
                  newCoords[0] !== pointXCoordsShared.value[0]) {
                pointXCoordsShared.value = newCoords;
              }

              return (
                <Area
                  points={points.y}
                  y0={chartBounds.bottom}
                  curveType="natural"
                >
                  <LinearGradient
                    start={vec(0, chartBounds.top)}
                    end={vec(0, chartBounds.bottom)}
                    colors={[chartColor + 'DD', chartColor + '50']}
                  />
                </Area>
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
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
              {formatDisplayValue(maxVal)}{unit}
            </Text>
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
              {formatDisplayValue(minVal)}{unit}
            </Text>
          </View>

          {/* X-axis labels */}
          <View style={styles.xAxisOverlay} pointerEvents="none">
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>0</Text>
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
              {maxDist.toFixed(1)} {distanceUnit}
            </Text>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 4,
    bottom: 16,
    width: 1,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 6,
    bottom: 16,
    left: 2,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 2,
    right: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overlayLabel: {
    fontSize: 9,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  overlayLabelDark: {
    color: '#CCC',
    backgroundColor: 'rgba(30, 30, 30, 0.7)',
  },
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
  tooltip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    zIndex: 10,
    alignItems: 'center',
  },
  tooltipDark: {
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
  },
  tooltipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipTextDark: {
    color: '#FFFFFF',
  },
});
