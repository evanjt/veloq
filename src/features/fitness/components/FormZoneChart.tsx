import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CartesianChart, Line } from 'victory-native';
import { Line as SkiaLine, Rect, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { colors, darkColors, opacity, typography, spacing, layout, chartStyles } from '@/theme';
import { ChartCrosshair, useChartColors, useChartGestures } from '@/shared/charts';
import {
  calculateTSB,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import { sortByDateId } from '@/features/activity/lib/activityUtils';
import { formatShortDate } from '@/shared/format/format';
import type { WellnessData } from '@/types';

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

interface ChartDataPoint {
  x: number;
  date: string;
  form: number;
  fitness: number;
  fatigue: number;
}

const CHART_PADDING = { left: 0, right: 0, top: 4, bottom: 4 } as const;

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
  const [selectedData, setSelectedData] = useState<ChartDataPoint | null>(null);
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const externalSelectedIdx = useSharedValue(-1);

  // Process data for the chart
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const withTSB = calculateTSB(data);
    const sorted = sortByDateId(withTSB);

    return sorted.map((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      // Use rounded values for form calculation to match intervals.icu display
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const form = fitness - fatigue;
      return {
        x: idx,
        date: day.id,
        form,
        fitness,
        fatigue,
      };
    });
  }, [data]);

  const handleSelect = useCallback((point: ChartDataPoint) => {
    setSelectedData(point);
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.form,
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
    useChartGestures<ChartDataPoint>({
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
      if (idx >= 0) {
        setSelectedData(chartData[idx]);
        externalSelectedIdx.value = idx;
      }
    } else if (!selectedDate && !isActive) {
      setSelectedData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  if (chartData.length === 0) {
    return null;
  }

  // Calculate domain - show at least -35 to 30
  const minForm = Math.min(-35, ...chartData.map((d) => d.form));
  const maxForm = Math.max(30, ...chartData.map((d) => d.form));

  // Get current (latest) values for display when not selecting
  const currentData = chartData[chartData.length - 1];
  const displayData = selectedData || currentData;
  const formZone = getFormZone(displayData.form);

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
          <Text style={[styles.formValue, { color: FORM_ZONE_COLORS[formZone] }]}>
            {displayData.form > 0 ? '+' : ''}
            {displayData.form}
          </Text>
          <Text style={[styles.zoneText, { color: FORM_ZONE_COLORS[formZone] }]}>
            {FORM_ZONE_LABELS[formZone]}
          </Text>
        </View>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={[chartStyles.chartWrapper, { height }]}>
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['form']}
            domain={{ y: [minForm, maxForm] }}
            padding={CHART_PADDING}
          >
            {({ points, chartBounds }) => {
              syncBounds(chartBounds);
              syncXCoords(points.form, (p) => p.x);

              const chartHeight = chartBounds.bottom - chartBounds.top;
              const yRange = maxForm - minForm;

              // Calculate zone rectangles
              const getZoneY = (value: number) => {
                const normalized = (maxForm - value) / yRange;
                return chartBounds.top + normalized * chartHeight;
              };

              return (
                <>
                  {/* Zone backgrounds */}
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.transition.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.transition.min)}
                    color={FORM_ZONE_COLORS.transition + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.fresh.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.fresh.min)}
                    color={FORM_ZONE_COLORS.fresh + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.greyZone.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.greyZone.min)}
                    color={FORM_ZONE_COLORS.greyZone + '20'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.optimal.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.optimal.min)}
                    color={FORM_ZONE_COLORS.optimal + '30'}
                  />
                  <ZoneBackground
                    bounds={chartBounds}
                    minY={getZoneY(FORM_ZONE_BOUNDARIES.highRisk.max)}
                    maxY={getZoneY(FORM_ZONE_BOUNDARIES.highRisk.min)}
                    color={FORM_ZONE_COLORS.highRisk + '30'}
                  />

                  {/* Zero line */}
                  <SkiaLine
                    p1={vec(chartBounds.left, getZoneY(0))}
                    p2={vec(chartBounds.right, getZoneY(0))}
                    color={chartColors.zeroLineSolid}
                    strokeWidth={1}
                    style="stroke"
                  />

                  {/* Form line with casing */}
                  <Line
                    points={points.form}
                    color={chartColors.casing}
                    strokeWidth={2}
                    curveType="natural"
                  />
                  <Line
                    points={points.form}
                    color={chartColors.formLine}
                    strokeWidth={1}
                    curveType="natural"
                  />
                </>
              );
            }}
          </CartesianChart>

          {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
          <ChartCrosshair style={crosshairStyle} bottomOffset={4} />

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {Math.round(maxForm)}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>0</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {Math.round(minForm)}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* Zone legend */}
      <View style={styles.zoneLegend}>
        {(['transition', 'fresh', 'greyZone', 'optimal', 'highRisk'] as FormZone[]).map((zone) => (
          <View key={zone} style={styles.zoneLegendItem}>
            <View style={[styles.zoneDot, { backgroundColor: FORM_ZONE_COLORS[zone] }]} />
            <Text style={[styles.zoneLabel, isDark && chartStyles.textDark]}>
              {FORM_ZONE_LABELS[zone]}
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
    fontSize: 24,
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
    fontSize: 8,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
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
    borderRadius: 3,
    marginRight: 3,
  },
  zoneLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
});
