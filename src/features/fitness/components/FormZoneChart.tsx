import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/shared/app';

import { EmptyState } from '@/shared/ui/EmptyState';
import { DenseText, denseExtent } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { chartStyles, spacing, typography } from '@/theme';
import {
  chartBoundsFor,
  ChartCanvas,
  ChartCrosshair,
  chartStroke,
  ChartSurface,
  CurveLine,
  dataExtent,
  projectRuns,
  ScrubDot,
  seriesSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  yForValue,
  YAxisLabels,
  type SummarySeries,
} from '@/shared/charts';
import {
  formZoneFromLoads,
  formZoneBandColor,
  formZoneLabel,
  FORM_ZONE_BOUNDARIES,
  formChartSeries,
  type FormChartPoint,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import { zoneLabelSpots, type ZoneBandPx } from '@/features/fitness/lib/zoneLabelSpots';
import { formatShortDate } from '@/shared/format/format';
import type { WellnessData } from '@/types';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

interface FormZoneChartProps {
  data: WellnessData[];
  height?: number;
  selectedDate?: string | null;
  /** Shared value for instant crosshair sync between charts */
  sharedSelectedIdx?: SharedValue<number>;
  onDateSelect?: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
  /** The data is the previous range's, kept on screen while the new range is read. */
  held?: boolean;
}

/** The card's one date axis, a label row under this, its last lane. */
const DATE_AXIS_HEIGHT = typography.caption.lineHeight;
// Half a label line above the top tick and below the bottom one, so each centres on its value,
// and the date row under the plot.
const CHART_PADDING = {
  top: typography.caption.lineHeight / 2,
  bottom: typography.caption.lineHeight / 2 + DATE_AXIS_HEIGHT,
} as const;
/** A zone name's width per character in ems, enough for the widest glyphs a name holds. */
const ZONE_LABEL_EMS_PER_CHAR = 0.6;
const ZONE_LABEL_INSET = spacing.xs;
const zoneLabelSize = (zone: FormZone) => {
  // Before the catalogue loads a name reads as nothing, and takes no width.
  const name: string | undefined = formZoneLabel(zone);
  return {
    width: denseExtent(typography.caption.fontSize, (name ?? '').length * ZONE_LABEL_EMS_PER_CHAR),
    height: denseExtent(typography.caption.lineHeight, 1),
  };
};
const signedForm = (n: number) => (n > 0 ? `+${n}` : String(n === 0 ? 0 : n));
const SERIES = { form: (d: FormChartPoint) => d.form };
const xOf = (d: FormChartPoint) => d.x;
const ZONES: FormZone[] = ['transition', 'fresh', 'greyZone', 'optimal', 'highRisk'];

export const FormZoneChart = React.memo(function FormZoneChart({
  data,
  height = 100,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
  held = false,
}: FormZoneChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const externalSelectedIdx = useSharedValue(-1);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onPlotLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setSize((prev) =>
      prev && prev.width === width && prev.height === h ? prev : { width, height: h }
    );
  }, []);
  const asPercent = useFormPreference((state) => state.formAsPercent) === true;

  const chartData = useMemo(() => formChartSeries(data ?? [], asPercent), [data, asPercent]);

  // What a screen reader hears and the Show data sheet lists: the form line, day by day.
  const reading = useMemo(() => {
    const series: SummarySeries = {
      name: t('metrics.form'),
      unit: asPercent ? '%' : undefined,
      points: chartData.map((d) => ({
        label: formatShortDate(d.date),
        key: d.date,
        value: d.form,
      })),
      format: (v) => `${signedForm(Math.round(v))}${asPercent ? '%' : ''}`,
    };
    return {
      summary: seriesSummary(series, t),
      table: seriesTable(series.name, t('charts.column.date'), [series]),
    };
  }, [chartData, asPercent, t]);

  const handleSelect = useCallback((point: FormChartPoint) => {
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.tsb,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (!active) {
      onDateSelectRef.current?.(null, null);
    }
  }, []);

  const describePoint = useCallback(
    (point: FormChartPoint) => {
      const day = formatShortDate(point.date);
      if (point.form === null)
        return `${day}, ${t('systemSurfaces.spoken.noReading', { label: t('metrics.form') })}`;
      const value = `${signedForm(Math.round(point.form))}${asPercent ? '%' : ''}`;
      // Zoned as the fitness readout zones the day, on the rounded loads it prints.
      const zone = formZoneFromLoads(point.fitness, point.fatigue, asPercent);
      return [day, `${t('metrics.form')} ${value}`, ...(zone ? [formZoneLabel(zone)] : [])].join(
        ', '
      );
    },
    [t, asPercent]
  );

  const {
    gesture,
    isActive,
    crosshairStyle,
    syncBounds,
    syncXCoords,
    accessibilityProps,
    scrubIndex,
  } = useChartGestures<FormChartPoint>({
    data: chartData,
    accessibilityLabel: t('metrics.form'),
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
    sharedSelectedIdx,
    externalSelectedIdx,
    describePoint,
  });

  // Sync with external selectedDate (from other chart)
  React.useEffect(() => {
    if (selectedDate && chartData.length > 0 && !isActive) {
      externalSelectedIdx.value = chartData.findIndex((d) => d.date === selectedDate);
    } else if (!selectedDate && !isActive) {
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  // The day this chart's scrub or step holds, else the day the sibling chart pinned.
  const scrubbed =
    scrubIndex >= 0
      ? chartData[scrubIndex]
      : selectedDate
        ? chartData.find((d) => d.date === selectedDate)
        : undefined;

  if (chartData.length === 0) {
    return <EmptyState variant="inline" title={t('fitness.noData')} />;
  }

  // Calculate domain - show at least -35 to 30
  const formValues = chartData.flatMap((d) => (d.form === null ? [] : [d.form]));
  const minForm = Math.min(-35, ...formValues);
  const maxForm = Math.max(30, ...formValues);
  const yDomain: [number, number] = [minForm, maxForm];
  // The ends and zero, each on its own value, so zero sits on the zero line.
  // The unit, when form is a percentage, is printed once, on the top label.
  const yTicks = [Math.round(maxForm), 0, Math.round(minForm)].map((value, i) => ({
    value,
    label: `${signedForm(value)}${asPercent && i === 0 ? '%' : ''}`,
  }));

  // Each zone named inside its band where the form line leaves room, in the
  // plot's own pixels so the names sit on the bands the canvas draws.
  const labelStyle = [chartStyles.chartLabel, isDark && chartStyles.chartLabelDark];
  const zoneSpots = (() => {
    if (!size) return [];
    const bounds = chartBoundsFor(size.width, size.height, {
      left: 0,
      right: 0,
      ...CHART_PADDING,
    });
    const bands: ZoneBandPx[] = ZONES.map((zone) => ({
      zone,
      top: Math.max(bounds.top, yForValue(FORM_ZONE_BOUNDARIES[zone].max, yDomain, bounds)),
      bottom: Math.min(bounds.bottom, yForValue(FORM_ZONE_BOUNDARIES[zone].min, yDomain, bounds)),
    }));
    const line = projectRuns(
      chartData,
      xOf,
      SERIES.form,
      dataExtent(chartData, xOf),
      yDomain,
      bounds
    );
    return zoneLabelSpots(bands, line, bounds, zoneLabelSize, ZONE_LABEL_INSET);
  })();

  return (
    <View style={styles.container}>
      <ChartSurface summary={reading.summary} table={reading.table} style={styles.plot} held={held}>
        <View style={styles.plotRow}>
          <YAxisLabels
            ticks={yTicks}
            domain={yDomain}
            padding={CHART_PADDING}
            testID="form-chart-y-axis"
          />
          <GestureDetector gesture={gesture}>
            <View
              style={[chartStyles.chartWrapper, { height: height + DATE_AXIS_HEIGHT }]}
              testID="form-chart-surface"
              onLayout={onPlotLayout}
              {...accessibilityProps}
            >
              <ChartCanvas
                data={chartData}
                x={xOf}
                series={SERIES}
                yDomain={yDomain}
                padding={CHART_PADDING}
                gridValues={yTicks.map((tick) => tick.value)}
              >
                {({ points, bounds, xFor, yFor }) => {
                  syncBounds(bounds);
                  // One coordinate per day, including a gap day, so a drag index is a data index.
                  syncXCoords(chartData, (d) => xFor(d.x));
                  return (
                    <>
                      {ZONES.map((zone) => (
                        <ZoneBackground
                          key={zone}
                          bounds={bounds}
                          minY={yFor(FORM_ZONE_BOUNDARIES[zone].max)}
                          maxY={yFor(FORM_ZONE_BOUNDARIES[zone].min)}
                          color={formZoneBandColor(zone, isDark)}
                        />
                      ))}
                      <SkiaLine
                        p1={vec(bounds.left, yFor(0))}
                        p2={vec(bounds.right, yFor(0))}
                        color={chartColors.zeroLineSolid}
                        strokeWidth={chartStroke.axis}
                        style="stroke"
                      />
                      <CurveLine
                        points={points.form}
                        color={chartColors.casing}
                        strokeWidth={chartStroke.casing}
                      />
                      <CurveLine points={points.form} color={chartColors.formLine} />
                      <ScrubDot
                        at={
                          scrubbed && scrubbed.form !== null
                            ? { x: xFor(scrubbed.x), y: yFor(scrubbed.form) }
                            : null
                        }
                        color={chartColors.formLine}
                      />
                    </>
                  );
                }}
              </ChartCanvas>

              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {zoneSpots.map((spot) => (
                  <DenseText
                    key={spot.zone}
                    testID={`form-zone-label-${spot.zone}`}
                    style={[...labelStyle, styles.zoneLabel, { left: spot.x, top: spot.y }]}
                  >
                    {formZoneLabel(spot.zone)}
                  </DenseText>
                ))}
              </View>

              {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
              <ChartCrosshair style={crosshairStyle} bottomOffset={DATE_AXIS_HEIGHT} />

              <View style={styles.dateAxis} pointerEvents="none" testID="form-chart-date-axis">
                <DenseText style={labelStyle}>{formatShortDate(chartData[0].date)}</DenseText>
                <DenseText style={labelStyle}>
                  {formatShortDate(chartData[chartData.length - 1].date)}
                </DenseText>
              </View>
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>
    </View>
  );
});

function ZoneBackground({
  bounds,
  minY,
  maxY,
  color,
}: {
  bounds: { left: number; right: number };
  minY: number;
  maxY: number;
  color: string;
}) {
  const height = maxY - minY;
  if (height <= 0) return null;

  return (
    <Rect
      x={bounds.left}
      y={minY}
      width={bounds.right - bounds.left}
      height={height}
      color={color}
    />
  );
}

const styles = StyleSheet.create({
  container: {},
  // The plot sets its own height, so the surface is sized by it rather than filling.
  plot: {
    flex: 0,
  },
  plotRow: {
    flexDirection: 'row',
  },
  zoneLabel: {
    position: 'absolute',
  },
  dateAxis: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: DATE_AXIS_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
