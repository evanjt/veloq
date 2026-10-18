import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
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
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { chartStyles, darkColors, colors, typography, spacing } from '@/theme';
import { formZoneColor } from '@/features/fitness';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formBarLayout } from '../lib/formBar';
import { riseDayPoints } from '../lib/fitnessChange';
import { scrubDateLabel } from '../lib/scrubDateLabel';
import {
  BAR_GAP,
  buildMonotoneSvg,
  ChartCrosshair,
  chartStroke,
  LINE_CAP,
  LINE_JOIN,
  ScrubDot,
  useChartColors,
  useChartGestures,
} from '@/shared/charts';
import { DenseText, denseExtent } from '@/shared/ui/DenseText';

const PLOT_TOP = 2;
const PLOT_BOTTOM = 2;

/**
 * Fewest days either sparkline draws. One day is a single point with no line
 * through it, and a full-width bar that scrubs to one value.
 */
export const SPARKLINE_MIN_DAYS = 2;

/** The inline label column holds one short word, "Fitness" or "Form", at the cap. */
const INLINE_LABEL_WIDTH = denseExtent(typography.caption.fontSize, 3.6);

const CHART_HEIGHT = 44;
const FORM_BAR_HEIGHT = 4;
/** The plot and the form bar under it: the row's height whatever the series. */
export const FITNESS_SPARKLINE_HEIGHT = CHART_HEIGHT + FORM_BAR_HEIGHT;
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
  const chartColors = useChartColors();
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

  const labelWidth = showLabels ? INLINE_LABEL_WIDTH : 0;
  const chartWidth = width - labelWidth;
  const totalHeight = FITNESS_SPARKLINE_HEIGHT;

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

  const { gesture, crosshairStyle, syncBounds, scrubIndex } = useChartGestures<number>({
    data: fitnessData,
    accessibilityLabel: t('metrics.fitness'),
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

  const plot = useMemo(
    () => ({
      width: chartWidth,
      top: PLOT_TOP,
      height: CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM,
      min: domain.y[0],
      max: domain.y[1],
    }),
    [chartWidth, domain]
  );

  const risePoints = useMemo(() => {
    if (!riseDays || riseDays.length === 0) return [];
    return riseDayPoints(fitnessData, riseDays, plot);
  }, [riseDays, fitnessData, plot]);

  // The scrubbed day on each line, which a dot marks.
  const scrubPoints = useMemo(() => {
    if (scrubIndex < 0) return null;
    return {
      fitness: riseDayPoints(fitnessData, [scrubIndex], plot)[0],
      fatigue: fatigueSeries ? riseDayPoints(fatigueSeries, [scrubIndex], plot)[0] : undefined,
    };
  }, [scrubIndex, fitnessData, fatigueSeries, plot]);

  if (
    fitnessData.length < SPARKLINE_MIN_DAYS ||
    formData.length < SPARKLINE_MIN_DAYS ||
    width <= 0
  ) {
    return <View style={{ width, height: totalHeight }} />;
  }

  // Each line in its one hue, the colour the Fitness chart draws it in.
  const fitnessLineColor = chartColors.fitness;
  const fatigueLineColor = chartColors.fatigue;

  const dividerColor = isDark ? darkColors.surface : colors.surface;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.container, chartStyles.plotDirection, { width, height: totalHeight }]}>
        <View style={styles.chartRow}>
          {/* Optional inline labels (settings preview only) */}
          {showLabels ? (
            <View style={[styles.labelColumn, { width: labelWidth }]}>
              <DenseText
                style={[chartStyles.chartLabelStrong, isDark && chartStyles.chartLabelStrongDark]}
              >
                {t('metrics.fitness')}
              </DenseText>
              <View style={{ flex: 1 }} />
              <DenseText
                style={[chartStyles.chartLabelStrong, isDark && chartStyles.chartLabelStrongDark]}
              >
                {t('metrics.form')}
              </DenseText>
            </View>
          ) : null}

          {/* Chart area - single Skia canvas: sparklines (top) + form zone bar (bottom) */}
          <View style={{ width: chartWidth, height: totalHeight }}>
            <Canvas style={{ width: chartWidth, height: totalHeight }}>
              {/* Fatigue (ATL) - drawn first so fitness renders on top */}
              {linePaths.fatigue ? (
                <Path
                  path={linePaths.fatigue}
                  color={fatigueLineColor}
                  style="stroke"
                  strokeWidth={chartStroke.series}
                  strokeJoin={LINE_JOIN}
                  strokeCap={LINE_CAP}
                />
              ) : null}
              {/* Fitness (CTL) - primary line, on top */}
              {linePaths.fitness ? (
                <Path
                  path={linePaths.fitness}
                  color={fitnessLineColor}
                  style="stroke"
                  strokeWidth={chartStroke.series}
                  strokeJoin={LINE_JOIN}
                  strokeCap={LINE_CAP}
                />
              ) : null}
              {risePoints.map((p, i) => (
                <Circle
                  key={`rise-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={RISE_DOT_RADIUS}
                  color={fitnessLineColor}
                />
              ))}
              {scrubPoints?.fatigue ? (
                <ScrubDot at={scrubPoints.fatigue} color={fatigueLineColor} />
              ) : null}
              {scrubPoints?.fitness ? (
                <ScrubDot at={scrubPoints.fitness} color={fitnessLineColor} />
              ) : null}
              {/* Form zone bar - directly below the chart (y = CHART_HEIGHT) */}
              {formBarRects.map((rect, i) => (
                <Rect
                  key={i}
                  x={rect.x}
                  y={CHART_HEIGHT}
                  width={rect.width}
                  height={FORM_BAR_HEIGHT}
                  color={rect.zone ? formZoneColor(rect.zone, isDark) : 'transparent'}
                />
              ))}
              {transitions.map((x, i) => (
                <SkiaLine
                  key={`div-${i}`}
                  p1={vec(x, CHART_HEIGHT)}
                  p2={vec(x, CHART_HEIGHT + FORM_BAR_HEIGHT)}
                  color={dividerColor}
                  strokeWidth={BAR_GAP}
                />
              ))}
            </Canvas>

            {/* Time range label */}
            <DenseText
              style={[
                styles.rangeLabel,
                { color: isDark ? darkColors.textSecondary : colors.textSecondary },
              ]}
            >
              {t('units.daysShort', { days: fitnessData.length })}
            </DenseText>

            <ChartCrosshair style={crosshairStyle} topOffset={0} bottomOffset={0} />
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
  rangeLabel: {
    ...typography.caption,
    position: 'absolute',
    bottom: '100%',
    right: 2,
  },
});
