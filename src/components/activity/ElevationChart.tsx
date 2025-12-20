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

interface ElevationChartProps {
  altitude?: number[];
  distance?: number[];
  height?: number;
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

export function ElevationChart({
  altitude = [],
  distance = [],
  height = 160,
  onPointSelect,
  onInteractionChange,
}: ElevationChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isMetric = useMetricSystem();
  const [tooltipValues, setTooltipValues] = React.useState<{ x: number; y: number } | null>(null);
  // Store corrected elevation for dot positioning
  const correctedElevationRef = useRef<number | null>(null);
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

  // Build data with original indices for mapping back
  const { data, indexMap } = useMemo(() => {
    if (altitude.length === 0) return { data: [], indexMap: [] as number[] };

    const maxPoints = 200;
    const step = Math.max(1, Math.floor(altitude.length / maxPoints));

    const points: { x: number; y: number; idx: number }[] = [];
    const indices: number[] = [];

    for (let i = 0; i < altitude.length; i += step) {
      const distKm = distance.length > i ? distance[i] / 1000 : i * 0.01;
      const altM = altitude[i];
      points.push({
        x: isMetric ? distKm : distKm * 0.621371,
        y: isMetric ? altM : altM * 3.28084,
        idx: i,
      });
      indices.push(i);
    }
    return { data: points, indexMap: indices };
  }, [altitude, distance, isMetric]);

  // Handle data lookup on JS thread with index offset correction
  const handleDataLookup = React.useCallback((matchedIndex: number, xValue: number, yValue: number) => {
    if (data.length === 0) return;

    const bounds = chartBoundsRef.current;
    const chartWidth = bounds.right - bounds.left;

    // Calculate how many data points the pixel offset corresponds to
    let indexOffset = 25; // Fallback offset
    let debugInfo = `w:0`;
    if (chartWidth > 0 && data.length > 1) {
      const pixelsPerPoint = chartWidth / (data.length - 1);
      indexOffset = Math.round(TOUCH_OFFSET_CORRECTION / pixelsPerPoint);
      debugInfo = `w:${Math.round(chartWidth)} off:${indexOffset}`;
    }

    // Apply the index offset (subtract because we're shifting left)
    const correctedIndex = Math.max(0, Math.min(data.length - 1, matchedIndex - indexOffset));

    const point = data[correctedIndex];
    if (point) {
      // Store corrected elevation for dot positioning
      correctedElevationRef.current = point.y;
      setTooltipValues({ x: point.x, y: point.y });
      if (onPointSelectRef.current && correctedIndex < indexMap.length) {
        const originalIndex = indexMap[correctedIndex];
        onPointSelectRef.current(originalIndex);
      }
    }
  }, [data, indexMap]);

  const handleClearSelection = React.useCallback(() => {
    correctedElevationRef.current = null;
    setTooltipValues(null);
    if (onPointSelectRef.current) {
      onPointSelectRef.current(null);
    }
  }, []);

  // Update tooltip and notify parent when selection changes
  useAnimatedReaction(
    () => ({
      matchedIndex: state.matchedIndex.value,
      x: state.x.value.value,
      y: state.y.y.value.value,
      active: isActive,
    }),
    (current) => {
      if (current.active) {
        runOnJS(handleDataLookup)(current.matchedIndex, current.x, current.y);
      } else {
        runOnJS(handleClearSelection)();
      }
    },
    [isActive, handleDataLookup, handleClearSelection]
  );

  const { minAlt, maxAlt, maxDist } = useMemo(() => {
    if (data.length === 0) {
      return { minAlt: 0, maxAlt: 100, maxDist: 1 };
    }
    const altitudes = data.map((d) => d.y);
    const distances = data.map((d) => d.x);
    const min = Math.min(...altitudes);
    const max = Math.max(...altitudes);
    const padding = (max - min) * 0.1 || 10;
    return {
      minAlt: Math.floor(min - padding),
      maxAlt: Math.ceil(max + padding),
      maxDist: Math.max(...distances),
    };
  }, [data]);

  const distanceUnit = isMetric ? 'km' : 'mi';
  const elevationUnit = isMetric ? 'm' : 'ft';

  if (data.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>No elevation data</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* Chart - optimized gesture handling for smooth tracking */}
      <View style={styles.chartWrapper}>
        {/* Tooltip display - inside chartWrapper to avoid coordinate offset */}
        {isActive && tooltipValues && (
          <View style={[styles.tooltip, isDark && styles.tooltipDark]} pointerEvents="none">
            <Text style={[styles.tooltipText, isDark && styles.tooltipTextDark]}>
              {tooltipValues.x.toFixed(2)} {distanceUnit}  •  {Math.round(tooltipValues.y)} {elevationUnit}
            </Text>
          </View>
        )}
        <CartesianChart
          data={data}
          xKey="x"
          yKeys={['y']}
          domain={{ y: [minAlt, maxAlt] }}
          padding={{ left: 0, right: 0, top: 4, bottom: 16 }}
          chartPressState={state}
          gestureLongPressDelay={50}
          gestureHandlerConfig={{
            // Allow unlimited vertical movement - only X matters
            failOffsetY: [-1000, 1000],
            // Very small horizontal threshold to stay active
            activeOffsetX: [-5, 5],
            // Extend touch area vertically but NOT horizontally (to avoid offset)
            hitSlop: { top: 60, bottom: 60, left: 0, right: 0 },
          }}
        >
          {({ points, chartBounds }) => {
            // Store chart bounds for corrected index calculation in animated reaction
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
                  colors={[colors.primary + 'AA', colors.primary + '20']}
                />
              </Area>
              {isActive && (
                <ActiveIndicator
                  xPosition={state.x.position}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  isDark={isDark}
                  correctedElevation={correctedElevationRef.current}
                  minAlt={minAlt}
                  maxAlt={maxAlt}
                />
              )}
            </>
            );
          }}
        </CartesianChart>

        {/* Y-axis labels overlaid on chart */}
        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
            {maxAlt}{elevationUnit}
          </Text>
          <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
            {minAlt}{elevationUnit}
          </Text>
        </View>

        {/* X-axis labels overlaid on chart */}
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
  correctedElevation,
  minAlt,
  maxAlt,
}: {
  xPosition: SharedValue<number>;
  top: number;
  bottom: number;
  isDark: boolean;
  correctedElevation: number | null;
  minAlt: number;
  maxAlt: number;
}) {
  // Apply offset correction to align crosshair with finger position
  const correctedX = useDerivedValue(() => xPosition.value - TOUCH_OFFSET_CORRECTION);
  const lineStart = useDerivedValue(() => vec(correctedX.value, top));
  const lineEnd = useDerivedValue(() => vec(correctedX.value, bottom));

  // Calculate Y position from corrected elevation value
  const chartHeight = bottom - top;
  const yRange = maxAlt - minAlt;
  let dotY = (top + bottom) / 2; // Default to center
  if (correctedElevation !== null && yRange > 0) {
    // Map elevation to pixel position (inverted: higher elevation = lower y pixel)
    const normalizedY = (correctedElevation - minAlt) / yRange;
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
        color={colors.primary}
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
  container: {
    // No margin - let parent handle spacing to avoid touch coordinate issues
  },
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
