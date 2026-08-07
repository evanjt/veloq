import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { Canvas, Path, Skia, vec, LinearGradient } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { darkColors, colors, colorWithOpacity } from '@/theme';
import {
  buildMonotoneSvg,
  buildMonotoneAreaSvg,
  useChartColors,
  useChartGestures,
} from '@/shared/charts';
import type { ScrubValues } from './SummaryCardSparkline';

/** Match total height of fitness sparkline (44 chart + 4 form bar) */
const CHART_HEIGHT = 48;
const PLOT_TOP = 2;
const PLOT_BOTTOM = 2;
const HRV_DOMAIN_MIN = -6;
const HRV_DOMAIN_MAX = 106;

interface SummaryCardHRVSparklineProps {
  hrvData: number[];
  rhrData?: number[];
  width: number;
  showLabels?: boolean;
  onScrub?: (values: ScrubValues | null) => void;
  onTap?: () => void;
}

/**
 * HRV + Resting HR sparkline chart for the SummaryCard.
 *
 * HRV rendered as a pink sparkline with gradient fill.
 * RHR as a subtle red sparkline (inverted - high RHR = low position).
 * Long-press to scrub - updates hero value via onScrub callback.
 */
export const SummaryCardHRVSparkline = memo(function SummaryCardHRVSparkline({
  hrvData,
  rhrData,
  width,
  showLabels = false,
  onScrub,
  onTap,
}: SummaryCardHRVSparklineProps) {
  const { isDark } = useTheme();
  const chartColors = useChartColors();

  const hrvRef = useRef(hrvData);
  hrvRef.current = hrvData;
  const rhrRef = useRef(rhrData);
  rhrRef.current = rhrData;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const hasRhr = rhrData && rhrData.length === hrvData.length;

  // HRV and RHR live on independent y-scales. Normalize both to 0-100 so they
  // share one domain ([-6, 106]) - RHR inverted (higher HR = worse = lower).
  const normalized = useMemo(() => {
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

    const hrv = hrvData.map((v) => ((v - hrvMin) / hrvRange) * 100);
    const rhr = hasRhr ? rhrData.map((v) => (1 - (v - rhrMin) / rhrRange) * 100) : null;
    return { hrv, rhr };
  }, [hrvData, rhrData, hasRhr]);

  // Crosshair state
  const labelWidth = showLabels ? 42 : 0;
  const chartWidth = width - labelWidth;

  const notifyScrub = useCallback((_point: number, index: number) => {
    const hrv = hrvRef.current;
    const rhr = rhrRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= hrv.length) return;
    const daysAgo = hrv.length - 1 - index;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateLabel = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    cb({
      fitness: 0,
      fatigue: 0,
      form: 0,
      hrv: hrv[index],
      rhr: rhr ? rhr[index] : undefined,
      dateLabel,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    if (!active) onScrubRef.current?.(null);
  }, []);

  const fireTap = useCallback(() => {
    onTapRef.current?.();
  }, []);

  const { gesture, crosshairStyle, syncBounds } = useChartGestures<number>({
    data: hrvData,
    scrubEnabled: !!onScrub,
    scrubActivation: 'drag',
    tapMaxDuration: 500,
    onSelect: notifyScrub,
    onInteractionChange: handleInteractionChange,
    onTap: onTap ? fireTap : undefined,
  });

  useEffect(() => {
    syncBounds({ left: 0, right: chartWidth, top: 0, bottom: CHART_HEIGHT });
  }, [syncBounds, chartWidth]);

  // Direct-Skia paths (replaces Victory CartesianChart): same monotoneX geometry,
  // no chart-tree mount cost. Area baseline matches the original <Area y0={CHART_HEIGHT}>
  // (a data-space value, kept for pixel parity).
  const skiaPaths = useMemo(() => {
    const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const hrvSvg = buildMonotoneSvg(
      normalized.hrv,
      HRV_DOMAIN_MIN,
      HRV_DOMAIN_MAX,
      chartWidth,
      PLOT_TOP,
      plotHeight
    );
    const rhrSvg = normalized.rhr
      ? buildMonotoneSvg(
          normalized.rhr,
          HRV_DOMAIN_MIN,
          HRV_DOMAIN_MAX,
          chartWidth,
          PLOT_TOP,
          plotHeight
        )
      : null;
    const areaSvg = buildMonotoneAreaSvg(
      normalized.hrv,
      HRV_DOMAIN_MIN,
      HRV_DOMAIN_MAX,
      chartWidth,
      PLOT_TOP,
      plotHeight,
      CHART_HEIGHT
    );
    return {
      hrv: hrvSvg ? Skia.Path.MakeFromSVGString(hrvSvg) : null,
      rhr: rhrSvg ? Skia.Path.MakeFromSVGString(rhrSvg) : null,
      area: areaSvg ? Skia.Path.MakeFromSVGString(areaSvg) : null,
    };
  }, [normalized, chartWidth]);

  if (hrvData.length < 2 || width <= 0) {
    return <View style={{ width, height: CHART_HEIGHT }} />;
  }

  const hrvLineColor = isDark ? colors.chartPink : colorWithOpacity(colors.chartPink, 0.85);
  const rhrLineColor = isDark ? colors.formHighRisk : colorWithOpacity(colors.formHighRisk, 0.65);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.container, { width, height: CHART_HEIGHT }]}>
        <View style={styles.chartRow}>
          {showLabels && (
            <View style={[styles.labelColumn, { width: labelWidth }]}>
              <RNText style={[styles.inlineLabel, { color: colors.chartPink }]}>HRV</RNText>
              <View style={{ flex: 1 }} />
              {hasRhr && (
                <RNText style={[styles.inlineLabel, { color: colors.formHighRisk }]}>RHR</RNText>
              )}
            </View>
          )}

          <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
            <Canvas style={{ width: chartWidth, height: CHART_HEIGHT }}>
              {/* HRV gradient fill */}
              {skiaPaths.area && (
                <Path path={skiaPaths.area} style="fill" opacity={0.15}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(0, CHART_HEIGHT)}
                    colors={[
                      isDark
                        ? colorWithOpacity(colors.chartPink, 0.38)
                        : colorWithOpacity(colors.chartPink, 0.25),
                      'transparent',
                    ]}
                  />
                </Path>
              )}

              {/* RHR line (drawn first so HRV renders on top) */}
              {hasRhr && skiaPaths.rhr && (
                <Path
                  path={skiaPaths.rhr}
                  color={chartColors.casing}
                  style="stroke"
                  strokeWidth={2}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {hasRhr && skiaPaths.rhr && (
                <Path
                  path={skiaPaths.rhr}
                  color={rhrLineColor}
                  style="stroke"
                  strokeWidth={1}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}

              {/* HRV line - primary, on top */}
              {skiaPaths.hrv && (
                <Path
                  path={skiaPaths.hrv}
                  color={chartColors.casing}
                  style="stroke"
                  strokeWidth={2}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {skiaPaths.hrv && (
                <Path
                  path={skiaPaths.hrv}
                  color={hrvLineColor}
                  style="stroke"
                  strokeWidth={1.5}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
            </Canvas>

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
