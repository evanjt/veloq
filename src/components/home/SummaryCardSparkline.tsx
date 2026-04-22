import React, { memo, useMemo, useRef } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { CartesianChart, Line } from 'victory-native';
import { Canvas, Rect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTheme } from '@/hooks';
import { darkColors, colors, colorWithOpacity } from '@/theme';
import { getFormZone, FORM_ZONE_COLORS, getIntlLocale } from '@/lib';

const CHART_HEIGHT = 44;
const FORM_BAR_HEIGHT = 4;

export interface ScrubValues {
  fitness: number;
  fatigue: number;
  form: number;
  hrv?: number;
  rhr?: number;
  dateLabel: string;
}

interface SummaryCardSparklineProps {
  fitnessData: number[];
  fatigueData?: number[];
  formData: number[];
  width: number;
  /** Show inline labels ("Fitness", "Form") — used in settings preview */
  showLabels?: boolean;
  /** Called during scrub with selected index values, or null on release */
  onScrub?: (values: ScrubValues | null) => void;
  /** Called for a single quick tap (no scrub) */
  onTap?: () => void;
}

/**
 * Fitness/Fatigue/Form sparkline chart for the SummaryCard.
 *
 * Fitness (CTL) rendered as a blue sparkline, Fatigue (ATL) as a pink sparkline.
 * Below: thin form zone bar colored by zone per day.
 * Right-aligned value labels show latest values (or scrubbed values during interaction).
 * Long-press to scrub — updates hero value via onScrub callback.
 */
export const SummaryCardSparkline = memo(function SummaryCardSparkline({
  fitnessData,
  fatigueData,
  formData,
  width,
  showLabels = false,
  onScrub,
  onTap,
}: SummaryCardSparklineProps) {
  const { isDark } = useTheme();

  // Refs for stable access inside gesture callbacks (avoids stale closures)
  const fitnessRef = useRef(fitnessData);
  fitnessRef.current = fitnessData;
  const fatigueRef = useRef(fatigueData);
  fatigueRef.current = fatigueData;
  const formRef = useRef(formData);
  formRef.current = formData;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const hasFatigue = fatigueData && fatigueData.length === fitnessData.length;

  const chartData = useMemo(
    () =>
      fitnessData.map((value, index) => ({
        x: index,
        fitness: value,
        fatigue: hasFatigue ? fatigueData[index] : value,
      })),
    [fitnessData, fatigueData, hasFatigue]
  );

  const domain = useMemo(() => {
    if (fitnessData.length === 0) return { y: [0, 100] as [number, number] };
    const allValues = hasFatigue ? [...fitnessData, ...fatigueData] : fitnessData;
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    // Ensure at least 1 unit range to avoid division by zero
    if (min === max) return { y: [min - 1, max + 1] as [number, number] };
    // Buffer the domain so casing strokes at min/max aren't clipped by the Skia clip rect.
    // CartesianChart clips children to chartBounds — a 2px stroke extends 1px beyond,
    // so we need enough domain headroom that the plotted extremes stay inside the clip.
    const range = max - min;
    return { y: [min - range * 0.06, max + range * 0.04] as [number, number] };
  }, [fitnessData, fatigueData, hasFatigue]);

  // Crosshair position shared value
  const crosshairX = useSharedValue(-1);

  // Chart bounds — synced from CartesianChart render callback
  const chartLeft = useSharedValue(0);
  const chartRight = useSharedValue(1);

  // JS-side scrub notification (called via runOnJS from worklet)
  const notifyScrub = (index: number) => {
    const fitness = fitnessRef.current;
    const fatigue = fatigueRef.current;
    const form = formRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= fitness.length) return;
    const daysAgo = fitness.length - 1 - index;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateLabel = date.toLocaleDateString(getIntlLocale(), {
      month: 'short',
      day: 'numeric',
    });
    cb({
      fitness: fitness[index],
      fatigue: fatigue ? fatigue[index] : fitness[index],
      form: form[index],
      dateLabel,
    });
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

  // Quick tap navigates; press-and-drag scrubs. Pan auto-activates on movement
  // so a stationary tap stays a tap.
  const scrubEnabled = !!onScrub;
  const fireTap = () => {
    onTapRef.current?.();
  };

  const tap = Gesture.Tap()
    .enabled(!!onTap)
    .maxDuration(500)
    .onEnd(() => {
      'worklet';
      runOnJS(fireTap)();
    });

  const pan = Gesture.Pan()
    .enabled(scrubEnabled)
    .activeOffsetX([-4, 4])
    .activeOffsetY([-4, 4])
    .onStart((e) => {
      'worklet';
      crosshairX.value = e.x;
      const idx = computeIndex(e.x);
      runOnJS(notifyScrub)(idx);
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

  const composed = Gesture.Exclusive(pan, tap);

  const crosshairStyle = useAnimatedStyle(() => {
    if (crosshairX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    const xPos = Math.max(0, Math.min(cWidth.value, crosshairX.value));
    return { opacity: 1, transform: [{ translateX: xPos }] };
  });

  const labelWidth = showLabels ? 42 : 0;
  const chartWidth = width - labelWidth;
  const totalHeight = CHART_HEIGHT + FORM_BAR_HEIGHT;

  if (fitnessData.length === 0 || formData.length === 0 || width <= 0) {
    return <View style={{ width, height: totalHeight }} />;
  }

  const labelColor = isDark ? darkColors.textMuted : colors.textMuted;
  const casingColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)';
  const fitnessLineColor = isDark ? colors.fitnessBlue : colorWithOpacity(colors.fitnessBlue, 0.85);
  const fatigueLineColor = isDark ? colors.chartPink : colorWithOpacity(colors.chartPink, 0.75);

  const dividerColor = isDark ? darkColors.surface : colors.surface;

  const { formBarRects, transitions } = useMemo(() => {
    const N = formData.length;
    // Match CartesianChart's N-1 interval spacing: point i at i * step
    const step = N > 1 ? chartWidth / (N - 1) : chartWidth;
    const rects = formData.map((value, i) => {
      const px = i * step;
      const left = i === 0 ? 0 : (px + (i - 1) * step) / 2;
      const right = i === N - 1 ? chartWidth : (px + (i + 1) * step) / 2;
      return {
        x: left,
        width: right - left + 0.5,
        color: FORM_ZONE_COLORS[getFormZone(value)],
      };
    });
    // Zone transition dividers at midpoints between adjacent chart points
    const trans: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      if (getFormZone(formData[i]) !== getFormZone(formData[i + 1])) {
        trans.push((i * step + (i + 1) * step) / 2);
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
            {/* Fitness + Fatigue sparklines — overflow visible so strokes aren't clipped */}
            <View style={{ height: CHART_HEIGHT, overflow: 'visible' }}>
              <CartesianChart
                data={chartData}
                xKey="x"
                yKeys={['fitness', 'fatigue']}
                yAxis={[{ tickCount: 0, labelOffset: 0 }]}
                domain={domain}
                padding={{ left: 0, right: 0, top: 2, bottom: 2 }}
              >
                {({ points, chartBounds }) => {
                  // Sync bounds to shared values for gesture computation
                  chartLeft.value = chartBounds.left;
                  chartRight.value = chartBounds.right;
                  return (
                    <>
                      {/* Fatigue (ATL) — drawn first so fitness renders on top */}
                      {hasFatigue && (
                        <>
                          <Line
                            points={points.fatigue}
                            color={casingColor}
                            strokeWidth={2}
                            curveType="monotoneX"
                          />
                          <Line
                            points={points.fatigue}
                            color={fatigueLineColor}
                            strokeWidth={1}
                            curveType="monotoneX"
                          />
                        </>
                      )}
                      {/* Fitness (CTL) — primary line, on top */}
                      <Line
                        points={points.fitness}
                        color={casingColor}
                        strokeWidth={2}
                        curveType="monotoneX"
                      />
                      <Line
                        points={points.fitness}
                        color={fitnessLineColor}
                        strokeWidth={1.5}
                        curveType="monotoneX"
                      />
                    </>
                  );
                }}
              </CartesianChart>
            </View>

            {/* Form zone bar — sits directly below chart, no gap */}
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
                  {
                    backgroundColor: isDark ? darkColors.textSecondary : colors.textSecondary,
                  },
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
    top: -12,
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
