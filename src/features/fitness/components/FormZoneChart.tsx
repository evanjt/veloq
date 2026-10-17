import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';

import { EmptyState } from '@/shared/ui/EmptyState';
import { useTranslation } from 'react-i18next';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { chartStyles, layout, type Palette, spacing, themedStyles, typography } from '@/theme';
import {
  ChartCanvas,
  ChartCrosshair,
  ChartSurface,
  CurveLine,
  seriesSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  YAxisLabels,
  type SummarySeries,
} from '@/shared/charts';
import {
  formZoneFromLoads,
  formZoneColor,
  formZoneLabel,
  FORM_ZONE_BOUNDARIES,
  formChartSeries,
  type FormChartPoint,
  type FormZone,
} from '@/features/fitness/lib/fitness';
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

// Half a label line above the top tick and below the bottom one, so each centres on its value.
const CHART_PADDING = {
  top: typography.caption.lineHeight / 2,
  bottom: typography.caption.lineHeight / 2,
} as const;
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
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const externalSelectedIdx = useSharedValue(-1);
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

  const { gesture, isActive, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<FormChartPoint>({
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
              style={[chartStyles.chartWrapper, { height }]}
              testID="form-chart-surface"
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
                          color={formZoneColor(zone, isDark) + (zone === 'greyZone' ? '20' : '30')}
                        />
                      ))}
                      <SkiaLine
                        p1={vec(bounds.left, yFor(0))}
                        p2={vec(bounds.right, yFor(0))}
                        color={chartColors.zeroLineSolid}
                        strokeWidth={1}
                        style="stroke"
                      />
                      <CurveLine points={points.form} color={chartColors.casing} strokeWidth={2} />
                      <CurveLine
                        points={points.form}
                        color={chartColors.formLine}
                        strokeWidth={1}
                      />
                    </>
                  );
                }}
              </ChartCanvas>

              {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
              <ChartCrosshair style={crosshairStyle} bottomOffset={4} />
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>

      {/* Zone legend */}
      <View style={styles.zoneLegend}>
        {ZONES.map((zone) => (
          <View key={zone} style={styles.zoneLegendItem}>
            <View style={[styles.zoneDot, { backgroundColor: formZoneColor(zone, isDark) }]} />
            <Text style={styles.zoneLabel}>{formZoneLabel(zone)}</Text>
          </View>
        ))}
      </View>
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

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    // The plot sets its own height, so the surface is sized by it rather than filling.
    plot: {
      flex: 0,
    },
    plotRow: {
      flexDirection: 'row',
    },
    zoneLegend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    zoneLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    zoneDot: {
      width: 6,
      height: 6,
      borderRadius: layout.borderRadiusFull,
      marginRight: spacing.xs,
    },
    zoneLabel: {
      ...typography.caption,
      color: palette.textSecondary,
    },
  });
