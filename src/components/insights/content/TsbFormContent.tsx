import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Canvas,
  Path,
  LinearGradient,
  vec,
  Line as SkiaLine,
  Rect,
} from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { useWellness } from '@/hooks/fitness/useWellness';
import { navigateTo } from '@/lib';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_BOUNDARIES } from '@/lib/algorithms/fitness';
import { colors, darkColors, spacing, opacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { Insight } from '@/types';
import type { LayoutChangeEvent } from 'react-native';

const CHART_HEIGHT = 160;
const CHART_PADDING = { top: 12, bottom: 24, left: 36, right: 12 };

interface TsbFormContentProps {
  insight: Insight;
}

export const TsbFormContent = React.memo(function TsbFormContent({ insight }: TsbFormContentProps) {
  const { isDark } = useTheme();
  const [chartWidth, setChartWidth] = useState(0);
  const onChartLayout = useCallback((e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  }, []);
  const { data: wellnessData } = useWellness('1m');

  // Extract CTL/ATL/TSB arrays from wellness
  const { fitnessData, formData, dates } = useMemo(() => {
    if (!wellnessData || wellnessData.length === 0) {
      return { fitnessData: [], formData: [], dates: [] };
    }
    const fitness: number[] = [];
    const form: number[] = [];
    const dateStrs: string[] = [];
    for (const day of wellnessData) {
      const ctl = day.ctl ?? day.ctlLoad ?? 0;
      const atl = day.atl ?? day.atlLoad ?? 0;
      fitness.push(ctl);
      form.push(ctl - atl);
      dateStrs.push(day.id ?? '');
    }
    return { fitnessData: fitness, formData: form, dates: dateStrs };
  }, [wellnessData]);

  // Get current values from insight data
  const tsbPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'TSB');
  const ctlPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'CTL');
  const atlPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'ATL');

  const tsbValue = typeof tsbPoint?.value === 'number' ? tsbPoint.value : 0;
  const ctlValue = typeof ctlPoint?.value === 'number' ? ctlPoint.value : 0;
  const atlValue = typeof atlPoint?.value === 'number' ? atlPoint.value : 0;
  const zone = getFormZone(tsbValue);
  const zoneColor = FORM_ZONE_COLORS[zone];
  const zoneBounds = FORM_ZONE_BOUNDARIES[zone];

  // Neutral zone description using boundary values
  const zoneDescription = useMemo(() => {
    if (zone === 'highRisk') return `TSB below ${zoneBounds.max}`;
    if (zone === 'transition') return `TSB above ${zoneBounds.min}`;
    return `TSB between ${zoneBounds.min} and ${zoneBounds.max}`;
  }, [zone, zoneBounds]);

  // Chart data: TSB line with zone-colored background bands
  const chartPaths = useMemo(() => {
    if (formData.length < 2 || chartWidth <= 0) return null;

    const allVals = formData;
    const min = Math.min(...allVals, -35);
    const max = Math.max(...allVals, 30);
    const range = max - min || 1;
    const padMin = min - range * 0.05;
    const padMax = max + range * 0.05;
    const yRange = padMax - padMin;

    const drawW = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
    const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

    const toY = (v: number) => CHART_PADDING.top + drawH - ((v - padMin) / yRange) * drawH;
    const toX = (i: number) => CHART_PADDING.left + (i / (formData.length - 1)) * drawW;

    // Build TSB line path
    let tsbPath = `M ${toX(0)} ${toY(formData[0])}`;
    for (let i = 1; i < formData.length; i++) {
      tsbPath += ` L ${toX(i)} ${toY(formData[i])}`;
    }

    // Build area path (fill below line to zero line)
    const zeroY = toY(0);
    let areaPath = tsbPath;
    areaPath += ` L ${toX(formData.length - 1)} ${zeroY} L ${toX(0)} ${zeroY} Z`;

    // Zone background bands
    const zones: { y: number; height: number; color: string }[] = [];
    const zoneList = ['transition', 'fresh', 'greyZone', 'optimal', 'highRisk'] as const;
    for (const z of zoneList) {
      const bounds = FORM_ZONE_BOUNDARIES[z];
      const top = Math.min(padMax, bounds.max);
      const bottom = Math.max(padMin, bounds.min);
      if (top <= padMin || bottom >= padMax) continue;
      const yTop = toY(top);
      const yBottom = toY(bottom);
      zones.push({
        y: yTop,
        height: Math.max(0, yBottom - yTop),
        color: `${FORM_ZONE_COLORS[z]}10`,
      });
    }

    // Y-axis ticks
    const tickStep = range > 40 ? 20 : range > 20 ? 10 : 5;
    const firstTick = Math.ceil(min / tickStep) * tickStep;
    const ticks: number[] = [];
    for (let v = firstTick; v <= max; v += tickStep) {
      ticks.push(v);
    }

    return { tsbPath, areaPath, zones, ticks, yMin: padMin, yMax: padMax, toY, zeroY };
  }, [formData, chartWidth]);

  const handleViewFitness = () => {
    navigateTo('/fitness');
  };

  const textMuted = isDark ? darkColors.textMuted : colors.textMuted;
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={styles.container}>
      {/* TSB value + zone */}
      <View style={[styles.statCard, isDark && styles.statCardDark]}>
        <Text style={[styles.tsbValue, { color: zoneColor }]}>{tsbValue}</Text>
        <View style={[styles.zoneBadge, { backgroundColor: `${zoneColor}20` }]}>
          <View style={[styles.zoneDot, { backgroundColor: zoneColor }]} />
          <Text style={[styles.zoneLabel, { color: zoneColor }]}>{zoneDescription}</Text>
        </View>
      </View>

      {/* CTL / ATL row */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricBox, isDark && styles.metricBoxDark]}>
          <Text style={[styles.metricLabel, isDark && styles.metricLabelDark]}>Fitness (CTL)</Text>
          <Text style={[styles.metricValue, isDark && styles.metricValueDark]}>{ctlValue}</Text>
        </View>
        <View style={[styles.metricBox, isDark && styles.metricBoxDark]}>
          <Text style={[styles.metricLabel, isDark && styles.metricLabelDark]}>Fatigue (ATL)</Text>
          <Text style={[styles.metricValue, isDark && styles.metricValueDark]}>{atlValue}</Text>
        </View>
      </View>

      {/* TSB chart with zone bands and axis labels */}
      {chartPaths ? (
        <ChartErrorBoundary height={CHART_HEIGHT}>
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>
              30-day form (TSB)
            </Text>
            <View style={styles.chartWrapper} onLayout={onChartLayout}>
              {chartWidth > 0 ? (
                <Canvas style={{ width: chartWidth, height: CHART_HEIGHT }}>
                  {/* Zone background bands */}
                  {chartPaths.zones.map((z, i) => (
                    <Rect
                      key={`zone-${i}`}
                      x={CHART_PADDING.left}
                      y={z.y}
                      width={chartWidth - CHART_PADDING.left - CHART_PADDING.right}
                      height={z.height}
                      color={z.color}
                    />
                  ))}
                  {/* Horizontal grid lines */}
                  {chartPaths.ticks.map((tick, i) => {
                    const y = chartPaths.toY(tick);
                    return (
                      <SkiaLine
                        key={`grid-${i}`}
                        p1={vec(CHART_PADDING.left, y)}
                        p2={vec(chartWidth - CHART_PADDING.right, y)}
                        color={gridColor}
                        strokeWidth={1}
                      />
                    );
                  })}
                  {/* Zero line */}
                  <SkiaLine
                    p1={vec(CHART_PADDING.left, chartPaths.zeroY)}
                    p2={vec(chartWidth - CHART_PADDING.right, chartPaths.zeroY)}
                    color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}
                    strokeWidth={1}
                  />
                  {/* TSB area fill */}
                  <Path path={chartPaths.areaPath} style="fill">
                    <LinearGradient
                      start={vec(0, CHART_PADDING.top)}
                      end={vec(0, CHART_HEIGHT - CHART_PADDING.bottom)}
                      colors={[`${zoneColor}25`, `${zoneColor}05`]}
                    />
                  </Path>
                  {/* TSB line */}
                  <Path
                    path={chartPaths.tsbPath}
                    style="stroke"
                    strokeWidth={2}
                    color={zoneColor}
                  />
                </Canvas>
              ) : null}

              {/* Y-axis labels */}
              {chartPaths.ticks.map((tick, i) => {
                const y = chartPaths.toY(tick);
                return (
                  <Text
                    key={`y-${i}`}
                    style={[
                      styles.axisLabel,
                      {
                        position: 'absolute',
                        left: 0,
                        top: y - 6,
                        width: CHART_PADDING.left - 4,
                        textAlign: 'right',
                        color: textMuted,
                      },
                    ]}
                  >
                    {tick}
                  </Text>
                );
              })}

              {/* X-axis date labels */}
              {dates.length >= 2 ? (
                <View
                  style={[
                    styles.xAxisRow,
                    { left: CHART_PADDING.left, right: CHART_PADDING.right },
                  ]}
                >
                  <Text style={[styles.axisLabel, { color: textMuted }]}>
                    {formatDateLabel(dates[0])}
                  </Text>
                  <Text style={[styles.axisLabel, { color: textMuted }]}>
                    {formatDateLabel(dates[dates.length - 1])}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </ChartErrorBoundary>
      ) : null}

      {/* View fitness link */}
      <Pressable style={[styles.navLink, isDark && styles.navLinkDark]} onPress={handleViewFitness}>
        <Text style={[styles.navLinkText, isDark && styles.navLinkTextDark]}>View fitness</Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={18}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
});

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  tsbValue: {
    fontSize: 36,
    fontWeight: '700',
  },
  zoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: spacing.xs,
    gap: 6,
  },
  zoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  zoneLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  metricBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  metricLabelDark: {
    color: darkColors.textSecondary,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricValueDark: {
    color: darkColors.textPrimary,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chartLabelDark: {
    color: darkColors.textSecondary,
  },
  chartWrapper: {
    position: 'relative',
    height: CHART_HEIGHT,
  },
  axisLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  xAxisRow: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  navLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  navLinkTextDark: {
    color: darkColors.textPrimary,
  },
});
