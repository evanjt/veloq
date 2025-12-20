import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Area, useChartPressState } from 'victory-native';
import { Circle, Line as SkiaLine, LinearGradient, vec } from '@shopify/react-native-skia';
import { getLocales } from 'expo-localization';
import { useDerivedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { colors, spacing, typography } from '@/theme';
import type { SharedValue } from 'react-native-reanimated';

// Offset correction for touch coordinate mismatch (pixels to shift left)
const TOUCH_OFFSET_CORRECTION = 30;

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

// Check if user's locale uses metric system
function useMetricSystem(): boolean {
  try {
    const locales = getLocales();
    const locale = locales[0];
    const imperialCountries = ['US', 'LR', 'MM'];
    return !imperialCountries.includes(locale?.regionCode || '');
  } catch {
    return true;
  }
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
  const [tooltipValues, setTooltipValues] = React.useState<{ x: number; y: number } | null>(null);
  // Store corrected value for dot positioning
  const correctedValueRef = useRef<number | null>(null);
  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;

  // Store chart bounds for corrected index calculation
  const chartBoundsRef = useRef({ left: 0, right: 0 });

  // Press state for interactive crosshair
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0 } });

  // Notify parent when interaction state changes
  useEffect(() => {
    if (onInteractionChangeRef.current) {
      onInteractionChangeRef.current(isActive);
    }
  }, [isActive]);

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

  // Handle data lookup on JS thread with index offset correction
  const handleDataLookup = React.useCallback((matchedIndex: number) => {
    if (data.length === 0) return;

    const bounds = chartBoundsRef.current;
    const chartWidth = bounds.right - bounds.left;

    // Calculate how many data points the pixel offset corresponds to
    let indexOffset = 25; // Fallback offset
    if (chartWidth > 0 && data.length > 1) {
      const pixelsPerPoint = chartWidth / (data.length - 1);
      indexOffset = Math.round(TOUCH_OFFSET_CORRECTION / pixelsPerPoint);
    }

    // Apply the index offset (subtract because we're shifting left)
    const correctedIndex = Math.max(0, Math.min(data.length - 1, matchedIndex - indexOffset));

    const point = data[correctedIndex];
    if (point) {
      // Store corrected value for dot positioning
      correctedValueRef.current = point.y;
      setTooltipValues({ x: point.x, y: point.y });
      if (onPointSelectRef.current && correctedIndex < indexMap.length) {
        const originalIndex = indexMap[correctedIndex];
        onPointSelectRef.current(originalIndex);
      }
    }
  }, [data, indexMap]);

  const handleClearSelection = React.useCallback(() => {
    correctedValueRef.current = null;
    setTooltipValues(null);
    if (onPointSelectRef.current) {
      onPointSelectRef.current(null);
    }
  }, []);

  // Update tooltip and notify parent when selection changes
  useAnimatedReaction(
    () => ({
      matchedIndex: state.matchedIndex.value,
      active: isActive,
    }),
    (current) => {
      if (current.active) {
        runOnJS(handleDataLookup)(current.matchedIndex);
      } else {
        runOnJS(handleClearSelection)();
      }
    },
    [isActive, handleDataLookup, handleClearSelection]
  );

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
      <View style={styles.chartWrapper}>
        {/* Tooltip display */}
        {isActive && tooltipValues && (
          <View style={[styles.tooltip, isDark && styles.tooltipDark]} pointerEvents="none">
            <Text style={[styles.tooltipText, isDark && styles.tooltipTextDark]}>
              {tooltipValues.x.toFixed(2)} {distanceUnit}  •  {formatDisplayValue(tooltipValues.y)} {unit}
            </Text>
          </View>
        )}
        <CartesianChart
          data={data}
          xKey="x"
          yKeys={['y']}
          domain={{ y: [minVal, maxVal] }}
          padding={{ left: 0, right: 0, top: 4, bottom: 16 }}
          chartPressState={state}
          gestureLongPressDelay={50}
        >
          {({ points, chartBounds }) => {
            chartBoundsRef.current = { left: chartBounds.left, right: chartBounds.right };

            return (
              <>
                <Area
                  points={points.y}
                  y0={chartBounds.bottom}
                  curveType="natural"
                >
                  <LinearGradient
                    start={vec(0, chartBounds.top)}
                    end={vec(0, chartBounds.bottom)}
                    colors={[chartColor + 'AA', chartColor + '20']}
                  />
                </Area>
                {isActive && (
                  <ActiveIndicator
                    xPosition={state.x.position}
                    top={chartBounds.top}
                    bottom={chartBounds.bottom}
                    isDark={isDark}
                    correctedValue={correctedValueRef.current}
                    minVal={minVal}
                    maxVal={maxVal}
                    color={chartColor}
                  />
                )}
              </>
            );
          }}
        </CartesianChart>

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
    </View>
  );
}

// Active crosshair indicator component
function ActiveIndicator({
  xPosition,
  top,
  bottom,
  isDark,
  correctedValue,
  minVal,
  maxVal,
  color,
}: {
  xPosition: SharedValue<number>;
  top: number;
  bottom: number;
  isDark: boolean;
  correctedValue: number | null;
  minVal: number;
  maxVal: number;
  color: string;
}) {
  const correctedX = useDerivedValue(() => xPosition.value - TOUCH_OFFSET_CORRECTION);
  const lineStart = useDerivedValue(() => vec(correctedX.value, top));
  const lineEnd = useDerivedValue(() => vec(correctedX.value, bottom));

  // Calculate Y position from corrected value
  const chartHeight = bottom - top;
  const yRange = maxVal - minVal;
  let dotY = (top + bottom) / 2;
  if (correctedValue !== null && yRange > 0) {
    const normalizedY = (correctedValue - minVal) / yRange;
    dotY = bottom - (normalizedY * chartHeight);
  }

  return (
    <>
      <SkiaLine
        p1={lineStart}
        p2={lineEnd}
        color={isDark ? '#888' : '#666'}
        strokeWidth={1}
        style="stroke"
      />
      <Circle
        cx={correctedX}
        cy={dotY}
        r={6}
        color={color}
      />
      <Circle
        cx={correctedX}
        cy={dotY}
        r={4}
        color="#FFFFFF"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {},
  chartWrapper: {
    flex: 1,
    position: 'relative',
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
