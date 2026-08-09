import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CartesianChart, Line, Area } from 'victory-native';
import { LinearGradient, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import { colors, darkColors, opacity, typography, spacing, layout, chartStyles } from '@/theme';
import { calculateTSB } from '@/features/fitness/lib/fitness';
import { sortByDateId } from '@/features/activity/lib/activityUtils';
import { formatShortDate } from '@/shared/format/format';
import { ChartErrorBoundary } from '@/shared/ui';
import { ChartCrosshair, useChartColors, useChartGestures } from '@/shared/charts';
import type { WellnessData } from '@/types';

interface FitnessChartProps {
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
  fitness: number;
  fatigue: number;
  form: number;
  load: number;
  [key: string]: string | number;
}

const CHART_PADDING = { left: 0, right: 0, top: 8, bottom: 20 } as const;

export const FitnessChart = React.memo(function FitnessChart({
  data,
  height = 200,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: FitnessChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const [tooltipData, setTooltipData] = useState<ChartDataPoint | null>(null);
  const [visibleLines, setVisibleLines] = useState({
    fitness: true,
    fatigue: true,
  });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  useEffect(() => {
    onDateSelectRef.current = onDateSelect;
    onInteractionChangeRef.current = onInteractionChange;
  }, [onDateSelect, onInteractionChange]);

  const externalSelectedIdx = useSharedValue(-1);

  const toggleLine = useCallback((line: 'fitness' | 'fatigue') => {
    setVisibleLines((prev) => ({ ...prev, [line]: !prev[line] }));
  }, []);

  // Process data for the chart
  const { chartData, indexMap, maxLoad, maxFitness, minForm, maxForm } = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        chartData: [],
        indexMap: [],
        maxLoad: 50,
        maxFitness: 100,
        minForm: -30,
        maxForm: 30,
      };
    }

    const withTSB = calculateTSB(data);
    const points: ChartDataPoint[] = [];
    const indices: number[] = [];

    // Sort by date
    const sorted = sortByDateId(withTSB);

    let maxL = 0;
    let maxF = 0;
    let minFm = 0;
    let maxFm = 0;

    sorted.forEach((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      // Use rounded values for form calculation to match intervals.icu display
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const form = fitness - fatigue;
      // Estimate daily load from the difference in fatigue (rough approximation)
      const load = day.sportInfo?.reduce((sum, s) => sum + (s.load || 0), 0) || 0;

      maxL = Math.max(maxL, load);
      maxF = Math.max(maxF, fitness, fatigue);
      minFm = Math.min(minFm, form);
      maxFm = Math.max(maxFm, form);

      points.push({
        x: idx,
        date: day.id,
        fitness,
        fatigue,
        form,
        load,
      });
      indices.push(idx);
    });

    return {
      chartData: points,
      indexMap: indices,
      maxLoad: Math.max(maxL, 50),
      maxFitness: Math.max(maxF, 50),
      minForm: Math.min(minFm, -10),
      maxForm: Math.max(maxFm, 10),
    };
  }, [data]);

  const handleSelect = useCallback((point: ChartDataPoint) => {
    setTooltipData(point);
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.form,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (!active) {
      setTooltipData(null);
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
        setTooltipData(chartData[idx]);
        externalSelectedIdx.value = idx;
      }
    } else if (!selectedDate && !isActive) {
      setTooltipData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  if (chartData.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && chartStyles.textDark]}>
          {t('fitness.noData')}
        </Text>
      </View>
    );
  }

  // Get current (latest) values
  const currentData = chartData[chartData.length - 1];
  const displayData = tooltipData || currentData;

  return (
    <ChartErrorBoundary height={height} label="Fitness Chart">
      <View style={[styles.container, { height }]}>
        {/* Header with values */}
        <View style={styles.header}>
          <View style={styles.dateContainer}>
            <Text style={[styles.dateText, isDark && styles.textLight]}>
              {(isActive && tooltipData) || selectedDate
                ? formatShortDate(tooltipData?.date || selectedDate || '')
                : t('time.current')}
            </Text>
          </View>
          <View style={styles.valuesRow}>
            <View style={styles.valueItem}>
              <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
                {t('metrics.fitness')}
              </Text>
              <Text
                testID="fitness-ctl-value"
                style={[styles.valueNumber, { color: chartColors.fitness }]}
              >
                {Math.round(displayData.fitness)}
              </Text>
            </View>
            <View style={styles.valueItem}>
              <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
                {t('metrics.fatigue')}
              </Text>
              <Text
                testID="fitness-atl-value"
                style={[styles.valueNumber, { color: chartColors.fatigue }]}
              >
                {Math.round(displayData.fatigue)}
              </Text>
            </View>
          </View>
        </View>

        {/* Chart */}
        <GestureDetector gesture={gesture}>
          <View style={chartStyles.chartWrapper}>
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={['fitness', 'fatigue']}
              domain={{ y: [0, maxFitness * 1.1] }}
              padding={CHART_PADDING}
            >
              {({ points, chartBounds }) => {
                syncBounds(chartBounds);
                syncXCoords(points.fitness, (p) => p.x);

                return (
                  <>
                    {/* Fitness area fill with gradient */}
                    {visibleLines.fitness && (
                      <Area points={points.fitness} y0={chartBounds.bottom} curveType="natural">
                        <LinearGradient
                          start={vec(0, chartBounds.top)}
                          end={vec(0, chartBounds.bottom)}
                          colors={[chartColors.fitness + '40', chartColors.fitness + '05']}
                        />
                      </Area>
                    )}

                    {/* Fitness line (CTL) with casing */}
                    {visibleLines.fitness && (
                      <>
                        <Line
                          points={points.fitness}
                          color={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}
                          strokeWidth={2.5}
                          curveType="natural"
                        />
                        <Line
                          points={points.fitness}
                          color={chartColors.fitness}
                          strokeWidth={1.5}
                          curveType="natural"
                        />
                      </>
                    )}

                    {/* Fatigue line (ATL) with casing */}
                    {visibleLines.fatigue && (
                      <>
                        <Line
                          points={points.fatigue}
                          color={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}
                          strokeWidth={2}
                          curveType="natural"
                        />
                        <Line
                          points={points.fatigue}
                          color={chartColors.fatigue}
                          strokeWidth={1}
                          curveType="natural"
                        />
                      </>
                    )}
                  </>
                );
              }}
            </CartesianChart>

            {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
            <ChartCrosshair style={crosshairStyle} topOffset={8} />

            {/* X-axis labels */}
            <View style={styles.xAxisOverlay} pointerEvents="none">
              <Text style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
                {chartData.length > 0 ? formatShortDate(chartData[0].date) : ''}
              </Text>
              <Text style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}>
                {chartData.length > 0 ? formatShortDate(chartData[chartData.length - 1].date) : ''}
              </Text>
            </View>
          </View>
        </GestureDetector>

        {/* Legend - pressable to toggle lines */}
        <View style={styles.legend}>
          <Pressable
            style={[styles.legendItem, !visibleLines.fitness && styles.legendItemDisabled]}
            onPress={() => toggleLine('fitness')}
            hitSlop={8}
          >
            <View
              style={[
                styles.legendDot,
                { backgroundColor: chartColors.fitness },
                !visibleLines.fitness && styles.legendDotDisabled,
              ]}
            />
            <Text
              style={[
                styles.legendText,
                isDark && chartStyles.textDark,
                !visibleLines.fitness && styles.legendTextDisabled,
              ]}
            >
              {t('fitness.fitnessCTL')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.legendItem, !visibleLines.fatigue && styles.legendItemDisabled]}
            onPress={() => toggleLine('fatigue')}
            hitSlop={8}
          >
            <View
              style={[
                styles.legendDot,
                { backgroundColor: chartColors.fatigue },
                !visibleLines.fatigue && styles.legendDotDisabled,
              ]}
            />
            <Text
              style={[
                styles.legendText,
                isDark && chartStyles.textDark,
                !visibleLines.fatigue && styles.legendTextDisabled,
              ]}
            >
              {t('fitness.fatigueATL')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {},
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
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
  valuesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueItem: {
    alignItems: 'center',
  },
  valueLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  valueNumber: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  legendItemDisabled: {
    opacity: 0.5,
  },
  legendDotDisabled: {
    opacity: 0.4,
  },
  legendTextDisabled: {
    textDecorationLine: 'line-through',
  },
});
