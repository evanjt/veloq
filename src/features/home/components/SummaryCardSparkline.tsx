import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import {
  Canvas,
  Circle,
  Rect,
  Line as SkiaLine,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { darkColors, colors, colorWithOpacity, typography, spacing } from '@/theme';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formBarLayout } from '../lib/formBar';
import { riseDayPoints } from '../lib/fitnessChange';
import { scrubDateLabel } from '../lib/scrubDateLabel';
import { buildMonotoneSvg, useChartGestures } from '@/shared/charts';

const PLOT_TOP = 2;
const PLOT_BOTTOM = 2;

/**
 * Fewest days either sparkline draws. One day is a single point with no line
 * through it, and a full-width bar that scrubs to one value.
 */
export const SPARKLINE_MIN_DAYS = 2;

const CHART_HEIGHT = 44;
const FORM_BAR_HEIGHT = 4;
const RISE_DOT_RADIUS = spacing.xxs;

export interface ScrubValues {
  fitness: number;
  fatigue: number;
  form: number;
  /** Null on a day with no reading of its own, which the line carries over. */
  hrv?: number | null | undefined;
  rhr?: number | null | undefined;
  dateLabel: string;
}

interface SummaryCardSparklineProps {
  fitnessData: number[];
  fatigueData?: number[] | undefined;
  formData: number[];
  /** Indices into `fitnessData` of the days fitness rose, marked with a dot. */
  riseDays?: number[] | undefined;
  width: number;
  /** Show inline labels ("Fitness", "Form") - used in settings preview */
  showLabels?: boolean | undefined;
  /** Called during scrub with selected index values, or null on release */
  onScrub?: ((values: ScrubValues | null) => void) | undefined;
  /** Called for a single quick tap (no scrub) */
  onTap?: (() => void) | undefined;
}

/**
 * Fitness/Fatigue/Form sparkline chart for the SummaryCard.
 *
 * Fitness (CTL) rendered as a blue sparkline, Fatigue (ATL) as a pink sparkline.
 * Below: thin form zone bar colored by zone per day.
 * Right-aligned value labels show latest values (or scrubbed values during interaction).
 * Long-press to scrub - updates hero value via onScrub callback.
 */
export const SummaryCardSparkline = memo(function SummaryCardSparkline({
  fitnessData,
  fatigueData,
  formData,
  riseDays,
  width,
  showLabels = false,
  onScrub,
  onTap,
}: SummaryCardSparklineProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

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

  const fatigueSeries =
    fatigueData && fatigueData.length === fitnessData.length ? fatigueData : null;

  const domain = useMemo(() => {
    if (fitnessData.length === 0) return { y: [0, 100] as [number, number] };
    const allValues = fatigueSeries ? [...fitnessData, ...fatigueSeries] : fitnessData;
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    // Ensure at least 1 unit range to avoid division by zero
    if (min === max) return { y: [min - 1, max + 1] as [number, number] };
    // Buffer the domain so casing strokes at min/max aren't clipped by the Skia clip rect.
    // CartesianChart clips children to chartBounds - a 2px stroke extends 1px beyond,
    // so we need enough domain headroom that the plotted extremes stay inside the clip.
    const range = max - min;
    return { y: [min - range * 0.06, max + range * 0.04] as [number, number] };
  }, [fitnessData, fatigueSeries]);

  const labelWidth = showLabels ? 42 : 0;
  const chartWidth = width - labelWidth;
  const totalHeight = CHART_HEIGHT + FORM_BAR_HEIGHT;

  // Index maps over the full chart width so the crosshair lines up with the
  // form bar rects, which are laid out on the same N-1 interval spacing.
  const notifyScrub = useCallback((_point: number, index: number) => {
    const fitness = fitnessRef.current;
    const fatigue = fatigueRef.current;
    const form = formRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= fitness.length) return;
    const dateLabel = scrubDateLabel(fitness.length - 1 - index);
    cb({
      fitness: fitness[index],
      fatigue: fatigue ? fatigue[index] : fitness[index],
      form: form[index],
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
    data: fitnessData,
    scrubEnabled: !!onScrub,
    scrubActivation: 'drag',
    tapMaxDuration: 500,
    onSelect: notifyScrub,
    onInteractionChange: handleInteractionChange,
    onTap: onTap ? fireTap : undefined,
  });

  useEffect(() => {
    syncBounds({ left: 0, right: chartWidth, top: 0, bottom: totalHeight });
  }, [syncBounds, chartWidth, totalHeight]);

  // Zoned like the hero above it: each day's form against that day's fitness,
  // under the athlete's form-as-percent setting.
  const asPercent = useFormPreference((state) => state.formAsPercent) === true;
  const { rects: formBarRects, transitions } = useMemo(
    () => formBarLayout(formData, fitnessData, asPercent, chartWidth),
    [formData, fitnessData, asPercent, chartWidth]
  );

  // Direct-Skia line paths (replaces Victory CartesianChart). monotoneX + the same
  // buffered domain as before → pixel-identical curves, but no chart-tree mount cost.
  const linePaths = useMemo(() => {
    const [min, max] = domain.y;
    const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const fitnessSvg = buildMonotoneSvg(fitnessData, min, max, chartWidth, PLOT_TOP, plotHeight);
    const fatigueSvg = fatigueSeries
      ? buildMonotoneSvg(fatigueSeries, min, max, chartWidth, PLOT_TOP, plotHeight)
      : null;
    return {
      fitness: fitnessSvg ? Skia.Path.MakeFromSVGString(fitnessSvg) : null,
      fatigue: fatigueSvg ? Skia.Path.MakeFromSVGString(fatigueSvg) : null,
    };
  }, [fitnessData, fatigueSeries, domain, chartWidth]);

  const risePoints = useMemo(() => {
    if (!riseDays || riseDays.length === 0) return [];
    const [min, max] = domain.y;
    return riseDayPoints(fitnessData, riseDays, {
      width: chartWidth,
      top: PLOT_TOP,
      height: CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM,
      min,
      max,
    });
  }, [riseDays, fitnessData, domain, chartWidth]);

  if (
    fitnessData.length < SPARKLINE_MIN_DAYS ||
    formData.length < SPARKLINE_MIN_DAYS ||
    width <= 0
  ) {
    return <View style={{ width, height: totalHeight }} />;
  }

  const labelColor = isDark ? darkColors.textMuted : colors.textMuted;
  const casingColor = isDark ? darkColors.chartCasing : colors.chartCasing;
  const fitnessLineColor = isDark ? colors.fitnessBlue : colorWithOpacity(colors.fitnessBlue, 0.85);
  const fatigueLineColor = isDark ? colors.chartPink : colorWithOpacity(colors.chartPink, 0.75);

  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.container, { width, height: totalHeight }]}>
        <View style={styles.chartRow}>
          {/* Optional inline labels (settings preview only) */}
          {showLabels && (
            <View style={[styles.labelColumn, { width: labelWidth }]}>
              <RNText
                style={[
                  styles.inlineLabel,
                  { color: isDark ? darkColors.fitnessBlueText : colors.fitnessBlueText },
                ]}
              >
                {t('metrics.fitness')}
              </RNText>
              <View style={{ flex: 1 }} />
              <RNText style={[styles.inlineLabel, { color: labelColor }]}>
                {t('metrics.form')}
              </RNText>
            </View>
          )}

          {/* Chart area - single Skia canvas: sparklines (top) + form zone bar (bottom) */}
          <View style={{ width: chartWidth, height: totalHeight }}>
            <Canvas style={{ width: chartWidth, height: totalHeight }}>
              {/* Fatigue (ATL) - drawn first so fitness renders on top */}
              {linePaths.fatigue && (
                <Path
                  path={linePaths.fatigue}
                  color={casingColor}
                  style="stroke"
                  strokeWidth={2}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {linePaths.fatigue && (
                <Path
                  path={linePaths.fatigue}
                  color={fatigueLineColor}
                  style="stroke"
                  strokeWidth={1}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {/* Fitness (CTL) - primary line, on top */}
              {linePaths.fitness && (
                <Path
                  path={linePaths.fitness}
                  color={casingColor}
                  style="stroke"
                  strokeWidth={2}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {linePaths.fitness && (
                <Path
                  path={linePaths.fitness}
                  color={fitnessLineColor}
                  style="stroke"
                  strokeWidth={1.5}
                  strokeJoin="round"
                  strokeCap="round"
                />
              )}
              {risePoints.map((p, i) => (
                <Circle
                  key={`rise-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={RISE_DOT_RADIUS}
                  color={fitnessLineColor}
                />
              ))}
              {/* Form zone bar - directly below the chart (y = CHART_HEIGHT) */}
              {formBarRects.map((rect, i) => (
                <Rect
                  key={i}
                  x={rect.x}
                  y={CHART_HEIGHT}
                  width={rect.width}
                  height={FORM_BAR_HEIGHT}
                  color={rect.color}
                />
              ))}
              {transitions.map((x, i) => (
                <SkiaLine
                  key={`div-${i}`}
                  p1={vec(x, CHART_HEIGHT)}
                  p2={vec(x, CHART_HEIGHT + FORM_BAR_HEIGHT)}
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
    paddingVertical: spacing.xxs,
  },
  inlineLabel: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '500',
  },
  rangeLabel: {
    position: 'absolute',
    top: -12,
    right: 2,
    fontSize: typography.pillLabel.fontSize,
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
