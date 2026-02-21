import React, { memo, useMemo, useRef } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { CartesianChart, Line } from 'victory-native';
import { Canvas, Rect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTheme } from '@/hooks';
import { darkColors, colors } from '@/theme';
import { getFormZone, FORM_ZONE_COLORS } from '@/lib';

const CHART_HEIGHT = 44;
const FORM_BAR_HEIGHT = 4;
const GAP = 3;
const LONG_PRESS_MS = 200;

interface ScrubValues {
  fitness: number;
  form: number;
  dateLabel: string;
}

interface SummaryCardSparklineProps {
  fitnessData: number[];
  formData: number[];
  width: number;
  /** Show inline labels ("Fitness", "Form") — used in settings preview */
  showLabels?: boolean;
  /** Called during scrub with selected index values, or null on release */
  onScrub?: (values: ScrubValues | null) => void;
}

/**
 * Dual Fitness/Form sparkline chart for the SummaryCard.
 *
 * Fitness (CTL) rendered as an outlined sparkline.
 * Below: thin form zone bar colored by zone per day.
 * Long-press to scrub — updates hero value via onScrub callback.
 */
export const SummaryCardSparkline = memo(function SummaryCardSparkline({
  fitnessData,
  formData,
  width,
  showLabels = false,
  onScrub,
}: SummaryCardSparklineProps) {
  const { isDark } = useTheme();

  // Refs for stable access inside gesture callbacks (avoids stale closures)
  const fitnessRef = useRef(fitnessData);
  fitnessRef.current = fitnessData;
  const formRef = useRef(formData);
  formRef.current = formData;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const chartData = useMemo(
    () => fitnessData.map((value, index) => ({ x: index, y: value })),
    [fitnessData]
  );

  const domain = useMemo(() => {
    if (fitnessData.length === 0) return { y: [0, 100] as [number, number] };
    const min = Math.min(...fitnessData);
    const max = Math.max(...fitnessData);
    const range = max - min;
    const padding = Math.max(range * 0.3, 5);
    return { y: [min - padding, max + padding] as [number, number] };
  }, [fitnessData]);

  // Crosshair position shared value
  const crosshairX = useSharedValue(-1);

  // Chart bounds — synced from CartesianChart render callback
  const chartLeft = useSharedValue(0);
  const chartRight = useSharedValue(1);

  // JS-side scrub notification (called via runOnJS from worklet)
  const notifyScrub = (index: number) => {
    const fitness = fitnessRef.current;
    const form = formRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= fitness.length) return;
    const daysAgo = fitness.length - 1 - index;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    cb({ fitness: fitness[index], form: form[index], dateLabel });
  };

  const clearScrub = () => {
    onScrubRef.current?.(null);
  };

  // Compute index from touch position (worklet)
  // Uses full chart width (0 → chartWidth) to match form bar rect positions
  const dataLength = useSharedValue(fitnessData.length);
  dataLength.value = fitnessData.length;
  const cWidth = useSharedValue(width);
  cWidth.value = width - (showLabels ? 42 : 0);

  const computeIndex = (x: number): number => {
    'worklet';
    const w = cWidth.value;
    if (w <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, x / w));
    return Math.round(ratio * (dataLength.value - 1));
  };

  // LongPress gates activation, then Pan handles dragging
  const longPress = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .onStart((e) => {
      'worklet';
      crosshairX.value = e.x;
      const idx = computeIndex(e.x);
      runOnJS(notifyScrub)(idx);
    })
    .shouldCancelWhenOutside(false);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, manager) => {
      // Only activate if longPress already fired (crosshairX >= 0)
      if (crosshairX.value >= 0) {
        manager.activate();
      } else {
        manager.fail();
      }
    })
    .onUpdate((e) => {
      'worklet';
      crosshairX.value = e.x;
      const idx = computeIndex(e.x);
      runOnJS(notifyScrub)(idx);
    })
    .onEnd(() => {
      'worklet';
      crosshairX.value = -1;
      runOnJS(clearScrub)();
    })
    .onFinalize(() => {
      'worklet';
      crosshairX.value = -1;
      runOnJS(clearScrub)();
    });

  const composed = Gesture.Simultaneous(longPress, pan);

  const crosshairStyle = useAnimatedStyle(() => {
    if (crosshairX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    const xPos = Math.max(0, Math.min(cWidth.value, crosshairX.value));
    return { opacity: 1, transform: [{ translateX: xPos }] };
  });

  const labelWidth = showLabels ? 42 : 0;
  const chartWidth = width - labelWidth;
  const totalHeight = CHART_HEIGHT + GAP + FORM_BAR_HEIGHT;

  if (fitnessData.length === 0 || formData.length === 0 || width <= 0) {
    return <View style={{ width, height: totalHeight }} />;
  }

  const labelColor = isDark ? darkColors.textMuted : colors.textMuted;
  // Dark outline adds definition without washing out zone colors
  // (White casing works on maps with varied backgrounds, but overpowers muted colors on uniform cards)
  const casingColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)';
  const fitnessLineColor = isDark ? '#42A5F5' : 'rgba(66,165,245,0.85)';

  const dividerColor = isDark ? '#18181B' : '#FFFFFF';

  const { formBarRects, transitions } = useMemo(() => {
    const barW = chartWidth / formData.length;
    const rects = formData.map((value, i) => ({
      x: i * barW,
      width: barW + 0.5,
      color: FORM_ZONE_COLORS[getFormZone(value)],
    }));
    // Find zone transition positions for divider lines
    const trans: number[] = [];
    for (let i = 0; i < formData.length - 1; i++) {
      if (getFormZone(formData[i]) !== getFormZone(formData[i + 1])) {
        trans.push((i + 1) * barW);
      }
    }
    return { formBarRects: rects, transitions: trans };
  }, [formData, chartWidth]);

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { width, height: totalHeight }]}>
        <View style={styles.chartRow}>
          {/* Optional inline labels (settings preview only) */}
          {showLabels && (
            <View style={[styles.labelColumn, { width: labelWidth }]}>
              <RNText style={[styles.inlineLabel, { color: colors.fitnessBlue }]}>Fitness</RNText>
              <View style={{ flex: 1 }} />
              <RNText style={[styles.inlineLabel, { color: labelColor }]}>Form</RNText>
            </View>
          )}

          {/* Chart area */}
          <View style={{ width: chartWidth, height: totalHeight }}>
            {/* Fitness sparkline with border outline */}
            <View style={{ height: CHART_HEIGHT }}>
              <CartesianChart
                data={chartData}
                xKey="x"
                yKeys={['y']}
                domain={domain}
                padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
              >
                {({ points, chartBounds }) => {
                  // Sync bounds to shared values for gesture computation
                  chartLeft.value = chartBounds.left;
                  chartRight.value = chartBounds.right;
                  return (
                    <>
                      {/* Casing — 0.5px border on each side (matches map polyline style) */}
                      <Line
                        points={points.y}
                        color={casingColor}
                        strokeWidth={2.5}
                        curveType="natural"
                      />
                      {/* Fitness line — colored fill on top */}
                      <Line
                        points={points.y}
                        color={fitnessLineColor}
                        strokeWidth={1.5}
                        curveType="natural"
                      />
                    </>
                  );
                }}
              </CartesianChart>
            </View>

            {/* Gap */}
            <View style={{ height: GAP }} />

            {/* Form zone bar — colored rects with dividers at zone transitions */}
            <Canvas style={{ width: chartWidth, height: FORM_BAR_HEIGHT }}>
              {formBarRects.map((rect, i) => (
                <Rect
                  key={i}
                  x={rect.x}
                  y={0}
                  width={rect.width}
                  height={FORM_BAR_HEIGHT}
                  color={rect.color}
                />
              ))}
              {transitions.map((x, i) => (
                <SkiaLine
                  key={`div-${i}`}
                  p1={vec(x, 0)}
                  p2={vec(x, FORM_BAR_HEIGHT)}
                  color={dividerColor}
                  strokeWidth={1}
                />
              ))}
            </Canvas>

            {/* Time range label */}
            <RNText
              style={[
                styles.rangeLabel,
                { color: isDark ? darkColors.textMuted : colors.textMuted },
              ]}
            >
              {fitnessData.length}d
            </RNText>

            {/* Crosshair overlay */}
            <Animated.View style={[styles.crosshair, crosshairStyle]} pointerEvents="none">
              <View
                style={[
                  styles.crosshairLine,
                  { backgroundColor: isDark ? darkColors.textSecondary : colors.textSecondary },
                ]}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flex: 1,
  },
  labelColumn: {
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  inlineLabel: {
    fontSize: 9,
    fontWeight: '500',
  },
  rangeLabel: {
    position: 'absolute',
    top: 0,
    right: 2,
    fontSize: 8,
    fontWeight: '500',
  },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
  },
  crosshairLine: {
    flex: 1,
    width: 1.5,
  },
});
