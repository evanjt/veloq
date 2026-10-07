import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import {
  colors,
  darkColors,
  typography,
  spacing,
  chartStyles,
  layout,
  colorWithOpacity,
  ink,
} from '@/theme';
import {
  ChartCanvas,
  ChartCrosshair,
  CurveLine,
  useChartColors,
  useChartGestures,
} from '@/shared/charts';
import {
  getFormZone,
  FORM_ZONE_COLORS,
  formZoneTextColor,
  FORM_ZONE_MARK_COLORS,
  formZoneLabel,
  FORM_ZONE_BOUNDARIES,
  formChartSeries,
  type FormChartPoint,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import { displayedDay } from '@/features/fitness/lib/pinnedDay';
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
}

const CHART_PADDING = { top: 4, bottom: 4 } as const;
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
}: FormZoneChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const [selectedData, setSelectedData] = useState<FormChartPoint | null>(null);
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const externalSelectedIdx = useSharedValue(-1);
  const asPercent = useFormPreference((state) => state.formAsPercent) === true;

  const chartData = useMemo(() => formChartSeries(data ?? [], asPercent), [data, asPercent]);

  const handleSelect = useCallback((point: FormChartPoint) => {
    setSelectedData(point);
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.tsb,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (!active) {
      setSelectedData(null);
      onDateSelectRef.current?.(null, null);
    }
  }, []);

  const { gesture, isActive, crosshairStyle, syncBounds, syncXCoords } =
    useChartGestures<FormChartPoint>({
      data: chartData,
      onSelect: handleSelect,
      onInteractionChange: handleInteractionChange,
      sharedSelectedIdx,
      externalSelectedIdx,
    });

  // Sync with external selectedDate (from other chart)
  React.useEffect(() => {
    if (selectedDate && chartData.length > 0 && !isActive) {
      const idx = chartData.findIndex((d) => d.date === selectedDate);
      // A pinned day with no row has nothing to show, which is not the last
      // day selected or the newest one.
      setSelectedData(idx >= 0 ? chartData[idx] : null);
      externalSelectedIdx.value = idx;
    } else if (!selectedDate && !isActive) {
      setSelectedData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  if (chartData.length === 0) {
    return null;
  }

  // Calculate domain - show at least -35 to 30
  const formValues = chartData.flatMap((d) => (d.form === null ? [] : [d.form]));
  const minForm = Math.min(-35, ...formValues);
  const maxForm = Math.max(30, ...formValues);
  const yDomain: [number, number] = [minForm, maxForm];

  const displayData = displayedDay({
    selectedDate,
    isActive,
    selected: selectedData,
    newest: chartData[chartData.length - 1],
  });
  // The series already carries the athlete's unit at full precision, so the thresholds apply as they are.
  const formZone = displayData && displayData.form !== null ? getFormZone(displayData.form) : null;
  const formText =
    displayData && displayData.form !== null
      ? `${signedForm(Math.round(displayData.form))}${asPercent ? '%' : ''}`
      : '-';

  return (
    <View style={styles.container}>
      {/* Header with values - always visible */}
      <View style={styles.header}>
        <View style={styles.dateContainer}>
          <Text style={[styles.dateText, isDark && styles.textLight]}>
            {(isActive && selectedData) || selectedDate
              ? formatShortDate(selectedData?.date || selectedDate || '')
              : t('time.current')}
          </Text>
        </View>
        <View style={styles.valuesRow}>
          <Text
            testID="form-chart-value"
            style={[
              styles.formValue,
              formZone
                ? { color: formZoneTextColor(formZone, isDark) }
                : isDark && styles.textLight,
            ]}
          >
            {formText}
          </Text>
          {formZone && (
            <Text
              testID="form-chart-zone"
              style={[styles.zoneText, { color: formZoneTextColor(formZone, isDark) }]}
            >
              {formZoneLabel(formZone)}
            </Text>
          )}
        </View>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={[chartStyles.chartWrapper, { height }]}>
          <ChartCanvas
            data={chartData}
            x={xOf}
            series={SERIES}
            yDomain={yDomain}
            padding={CHART_PADDING}
            grid={5}
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
                      color={FORM_ZONE_COLORS[zone] + (zone === 'greyZone' ? '20' : '30')}
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
                  <CurveLine points={points.form} color={chartColors.formLine} strokeWidth={1} />
                </>
              );
            }}
          </ChartCanvas>

          {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
          <ChartCrosshair style={crosshairStyle} bottomOffset={4} />

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark]}
            >
              {Math.round(maxForm)}
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark]}
            >
              0
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark]}
            >
              {Math.round(minForm)}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* Zone legend */}
      <View style={styles.zoneLegend}>
        {ZONES.map((zone) => (
          <View key={zone} style={styles.zoneLegendItem}>
            <View style={[styles.zoneDot, { backgroundColor: FORM_ZONE_MARK_COLORS[zone] }]} />
            <Text style={[styles.zoneLabel, isDark && chartStyles.textDark]}>
              {formZoneLabel(zone)}
            </Text>
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

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  dateContainer: {
    flex: 1,
  },
  dateText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  valuesRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  formValue: {
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
  },
  zoneText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 2,
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    backgroundColor: colorWithOpacity(ink.white, 0.7),
    paddingHorizontal: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
  },
  axisLabelDark: {
    color: darkColors.textPrimary,
    backgroundColor: darkColors.surfaceOverlay,
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
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
});
