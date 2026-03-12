import React, { memo, useMemo, useRef } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { CartesianChart, Line, Area } from 'victory-native';
import { vec, LinearGradient } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { useTheme } from '@/hooks';
import { darkColors, colors } from '@/theme';
import type { ScrubValues } from './SummaryCardSparkline';

/** Match total height of fitness sparkline (44 chart + 4 form bar) */
const CHART_HEIGHT = 48;
const LONG_PRESS_MS = 200;

interface SummaryCardHRVSparklineProps {
  hrvData: number[];
  rhrData?: number[];
  width: number;
  showLabels?: boolean;
  onScrub?: (values: ScrubValues | null) => void;
}

/**
 * HRV + Resting HR sparkline chart for the SummaryCard.
 *
 * HRV rendered as a pink sparkline with gradient fill.
 * RHR as a subtle red sparkline (inverted — high RHR = low position).
 * Long-press to scrub — updates hero value via onScrub callback.
 */
export const SummaryCardHRVSparkline = memo(function SummaryCardHRVSparkline({
  hrvData,
  rhrData,
  width,
  showLabels = false,
  onScrub,
}: SummaryCardHRVSparklineProps) {
  const { isDark } = useTheme();

  const hrvRef = useRef(hrvData);
  hrvRef.current = hrvData;
  const rhrRef = useRef(rhrData);
  rhrRef.current = rhrData;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const hasRhr = rhrData && rhrData.length === hrvData.length;

  // Dual-axis chart data: HRV and RHR on independent y-scales.
  // Normalize both to 0-100 range so they share the same CartesianChart domain.
  const chartData = useMemo(() => {
    const hrvMin = Math.min(...hrvData);
    const hrvMax = Math.max(...hrvData);
    const hrvRange = hrvMax - hrvMin || 1;

    let rhrMin = 0;
    let rhrRange = 1;
    if (hasRhr) {
      rhrMin = Math.min(...rhrData);
      const rhrMax = Math.max(...rhrData);
      rhrRange = rhrMax - rhrMin || 1;
    }

    return hrvData.map((hrv, index) => {
      const normHrv = ((hrv - hrvMin) / hrvRange) * 100;
      // Invert RHR so higher HR (worse) maps to lower position on chart
      const normRhr = hasRhr ? (1 - (rhrData[index] - rhrMin) / rhrRange) * 100 : normHrv;
      return { x: index, hrv: normHrv, rhr: normRhr };
    });
  }, [hrvData, rhrData, hasRhr]);

  const domain = useMemo(() => ({ y: [-6, 106] as [number, number] }), []);

  // Crosshair state
  const crosshairX = useSharedValue(-1);

  const notifyScrub = (index: number) => {
    const hrv = hrvRef.current;
    const rhr = rhrRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= hrv.length) return;
    const daysAgo = hrv.length - 1 - index;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    cb({
      fitness: 0,
      fatigue: 0,
      form: 0,
      hrv: hrv[index],
      rhr: rhr ? rhr[index] : undefined,
      dateLabel,
    });
  };

  const clearScrub = () => {
    onScrubRef.current?.(null);
  };

  const dataLength = useSharedValue(hrvData.length);
  dataLength.value = hrvData.length;
  const cWidth = useSharedValue(width);
  cWidth.value = width - (showLabels ? 42 : 0);

  const computeIndex = (x: number): number => {
    'worklet';
    const w = cWidth.value;
    if (w <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, x / w));
    return Math.round(ratio * (dataLength.value - 1));
  };

  const scrubEnabled = !!onScrub;
  const longPress = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .enabled(scrubEnabled)
    .onBegin(() => {
      'worklet';
      if (crosshairX.value >= 0) {
        crosshairX.value = -1;
        runOnJS(clearScrub)();
      }
    })
    .onStart((e) => {
      'worklet';
      crosshairX.value = e.x;
      const idx = computeIndex(e.x);
      runOnJS(notifyScrub)(idx);
    })
    .shouldCancelWhenOutside(false);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .enabled(scrubEnabled)
    .onTouchesMove((_, manager) => {
      if (crosshairX.value >= 0) {
        manager.activate();
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

  if (hrvData.length < 2 || width <= 0) {
    return <View style={{ width, height: CHART_HEIGHT }} />;
  }

  const casingColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)';
  const hrvLineColor = isDark ? '#EC4899' : 'rgba(236,72,153,0.85)';
  const rhrLineColor = isDark ? '#EF5350' : 'rgba(239,83,80,0.65)';

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { width, height: CHART_HEIGHT }]}>
        <View style={styles.chartRow}>
          {showLabels && (
            <View style={[styles.labelColumn, { width: labelWidth }]}>
              <RNText style={[styles.inlineLabel, { color: colors.chartPink }]}>HRV</RNText>
              <View style={{ flex: 1 }} />
              {hasRhr && <RNText style={[styles.inlineLabel, { color: '#EF5350' }]}>RHR</RNText>}
            </View>
          )}

          <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
            <View style={{ height: CHART_HEIGHT, overflow: 'visible' }}>
              <CartesianChart
                data={chartData}
                xKey="x"
                yKeys={['hrv', 'rhr']}
                yAxis={[{ tickCount: 0, labelOffset: 0 }]}
                domain={domain}
                padding={{ left: 0, right: 0, top: 2, bottom: 2 }}
              >
                {({ points }) => (
                  <>
                    {/* HRV gradient fill */}
                    <Area
                      points={points.hrv}
                      y0={CHART_HEIGHT}
                      curveType="monotoneX"
                      opacity={0.15}
                    >
                      <LinearGradient
                        start={vec(0, 0)}
                        end={vec(0, CHART_HEIGHT)}
                        colors={[isDark ? '#EC489960' : '#EC489940', 'transparent']}
                      />
                    </Area>

                    {/* RHR line (drawn first so HRV renders on top) */}
                    {hasRhr && (
                      <>
                        <Line
                          points={points.rhr}
                          color={casingColor}
                          strokeWidth={2}
                          curveType="monotoneX"
                        />
                        <Line
                          points={points.rhr}
                          color={rhrLineColor}
                          strokeWidth={1}
                          curveType="monotoneX"
                        />
                      </>
                    )}

                    {/* HRV line — primary, on top */}
                    <Line
                      points={points.hrv}
                      color={casingColor}
                      strokeWidth={2}
                      curveType="monotoneX"
                    />
                    <Line
                      points={points.hrv}
                      color={hrvLineColor}
                      strokeWidth={1.5}
                      curveType="monotoneX"
                    />
                  </>
                )}
              </CartesianChart>
            </View>

            {/* Time range label */}
            <RNText
              style={[
                styles.rangeLabel,
                { color: isDark ? darkColors.textMuted : colors.textMuted },
              ]}
            >
              {hrvData.length}d
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
