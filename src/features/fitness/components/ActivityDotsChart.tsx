import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { Group } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import {
  ChartBar,
  ChartCrosshair,
  ChartSurface,
  type ChartReadingSource,
  daysTable,
  stripSummary,
  useChartGestures,
  type SummaryDay,
} from '@/shared/charts';
import { colors, darkColors, spacing, layout, stroke, iconSize } from '@/theme';
import { sortByDateId } from '@/shared/activity/activityUtils';
import { sportFamilyIcon, sportFamilyLabel } from '@/shared/activity/sportCategories';
import type { DayLoad } from 'veloqrs';
import type { WellnessData } from '@/types';
import { stripMarks, stripKey, markFills, portionGap } from '../lib/stripMarks';
import { dayLoadReadout } from '../lib/dayLoadReadout';
import { groupColor } from '../lib/dayPillTone';
import { formFromLoads } from '@/shared/math';
import { formatShortDate } from '@/shared/format/format';
import { Icon } from '@/shared/ui';

import { useOpenDayActivities, type DayActivity } from '@/features/activity/light';

interface ActivityDotsChartProps {
  /** Wellness data for date alignment */
  data: WellnessData[];
  /** Activities to display as dots, as the engine lists them. */
  activities?: DayActivity[];
  /** Recorded activity load per local day, from the engine. */
  dailyLoads?: DayLoad[];
  height?: number;
  /** The width of the value-axis gutter the plots above and below it carry, which this strip leaves blank. */
  gutterWidth?: number;
  selectedDate?: string | null;
  sharedSelectedIdx?: SharedValue<number>;
  onDateSelect?: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
}

interface DotData {
  x: number;
  date: string;
  activities: DayActivity[];
  fitness: number;
  fatigue: number;
  form: number;
}

export const ActivityDotsChart = React.memo(function ActivityDotsChart({
  data,
  activities = [],
  dailyLoads,
  height = 40,
  gutterWidth = 0,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: ActivityDotsChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [chartWidth, setChartWidth] = useState(0);
  const openDay = useOpenDayActivities();
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const selectedDataRef = useRef<DotData | null>(null);
  const externalSelectedIdx = useSharedValue(-1);

  // Build a map of activities by date
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, DayActivity[]>();
    for (const activity of activities) {
      const date = activity.startDateLocal.split('T')[0];
      if (!date) continue;

      let onDay = map.get(date);
      if (!onDay) {
        onDay = [];
        map.set(date, onDay);
      }
      onDay.push(activity);
    }
    return map;
  }, [activities]);

  // Process wellness data and match with activities
  const dotData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const sorted = sortByDateId(data);

    return sorted.map((day, idx) => {
      const fitnessRaw = day.ctl ?? 0;
      const fatigueRaw = day.atl ?? 0;
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const dayActivities = activitiesByDate.get(day.id) || [];

      return {
        x: idx,
        date: day.id,
        activities: dayActivities,
        fitness,
        fatigue,
        form: formFromLoads(fitnessRaw, fatigueRaw),
      };
    });
  }, [data, activitiesByDate]);

  const handleSelect = useCallback((point: DotData) => {
    selectedDataRef.current = point;
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.form,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (active) return;
    selectedDataRef.current = null;
    onDateSelectRef.current?.(null, null);
  }, []);

  // What a screen reader hears and the Show data sheet lists: the days marked, and what fell on each.
  const reading = useMemo<ChartReadingSource>(() => {
    const build = () => {
      const title = t('fitness.daysTrained');
      const days: SummaryDay[] = dotData.map((day) => ({
        label: formatShortDate(day.date),
        key: day.date,
        count: day.activities.length,
        cells: [day.activities.map((activity) => activity.name).join(', ')],
      }));
      return {
        summary: stripSummary(title, days, t),
        table: daysTable(title, [t('charts.column.date'), t('charts.column.activities')], days),
      };
    };
    return { hasRows: dotData.some((day) => day.activities.length > 0), read: build };
  }, [dotData, t]);

  const loadByDate = useMemo(
    () => new Map((dailyLoads ?? []).map((d) => [d.date, d])),
    [dailyLoads]
  );

  const describePoint = useCallback(
    (point: DotData) => {
      const [first, ...rest] = point.activities;
      const trained = !first
        ? t('fitness.restDay')
        : rest.length === 0
          ? first.name
          : t('fitness.activitiesCount', { count: point.activities.length });
      const readout = dayLoadReadout(loadByDate.get(point.date));
      const load =
        readout === null
          ? []
          : [
              `${t('metrics.trainingLoad')} ${
                readout.total === null ? t('fitness.loadUnavailable') : readout.total
              }`,
            ];
      return [formatShortDate(point.date), trained, ...load].join(', ');
    },
    [t, loadByDate]
  );

  // A tap on the strip opens the activities of the day under the finger; a drag scrubs.
  const handleTap = useCallback(
    (x: number) => {
      if (dotData.length === 0 || chartWidth <= 0) return;
      const idx = Math.round((x / chartWidth) * (dotData.length - 1));
      const day = dotData[Math.min(Math.max(idx, 0), dotData.length - 1)];
      if (day) void openDay(day.activities);
    },
    [dotData, chartWidth, openDay]
  );

  const { gesture, isActive, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<DotData>({
      data: dotData,
      accessibilityLabel: t('fitness.daysTrained'),
      onSelect: handleSelect,
      onInteractionChange: handleInteractionChange,
      sharedSelectedIdx,
      externalSelectedIdx,
      crosshairMode: 'finger',
      describePoint,
      onTap: handleTap,
    });

  // Sync with external selectedDate
  React.useEffect(() => {
    if (selectedDate && dotData.length > 0 && !isActive) {
      externalSelectedIdx.value = dotData.findIndex((d) => d.date === selectedDate);
    } else if (!selectedDate && !isActive) {
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, dotData, isActive, externalSelectedIdx]);

  // One mark per active date, constant height, split equally by sport.
  const marks = useMemo(() => stripMarks(dotData, chartWidth), [dotData, chartWidth]);

  const key = useMemo(() => stripKey(dotData), [dotData]);

  // Days sit on an even split of the width, so the crosshair can land on one
  // even when the selection came from another chart.
  const dotXCoords = useMemo(
    () => dotData.map((_, idx) => (idx / (dotData.length - 1 || 1)) * chartWidth),
    [dotData, chartWidth]
  );

  React.useEffect(() => {
    syncBounds({ left: 0, right: chartWidth, top: 0, bottom: height });
    syncXCoords(dotXCoords, (x) => x);
  }, [syncBounds, syncXCoords, dotXCoords, chartWidth, height]);

  // Below every hook, so the hook count stays fixed across renders.
  if (dotData.length === 0) {
    return null;
  }

  const mutedColor = isDark ? darkColors.textDisabled : colors.textDisabled;
  const colorOf = (group: string) => groupColor(group, isDark);
  return (
    <View style={styles.container}>
      <ChartSurface reading={reading} testID="activity-dots-plot" showDataButton={false}>
        <View style={styles.plotRow}>
          <View testID="activity-dots-gutter" style={{ width: gutterWidth }} />
          <GestureDetector gesture={gesture}>
            <View
              style={[styles.chartWrapper, { height }]}
              testID="activity-dots-surface"
              {...accessibilityProps}
              onLayout={(e) => {
                setChartWidth(e.nativeEvent.layout.width);
              }}
            >
              {chartWidth > 0 && (
                <Canvas style={styles.canvas}>
                  <Group>
                    {marks.map((mark) => {
                      const total = mark.height * height;
                      // The first portion sits on the floor and each next one stacks above it.
                      let bottom = height;
                      const fills = markFills(mark, mutedColor, colorOf);
                      // Stacked portions are parted by the bar gap of surface, not a divider.
                      const gap = portionGap(total, fills.length);
                      const drawn = total - (fills.length - 1) * gap;
                      return fills.map((fill, n) => {
                        const y = bottom;
                        const fillHeight = fill.fraction * drawn;
                        bottom -= fillHeight + gap;
                        return (
                          <ChartBar
                            key={`${mark.dates[0]}-${n}`}
                            x={mark.x + mark.width / 2}
                            from={y}
                            to={y - fillHeight}
                            width={mark.width}
                            color={fill.color}
                            outline={fill.outline}
                          />
                        );
                      });
                    })}
                  </Group>
                </Canvas>
              )}

              {/* Crosshair */}
              <ChartCrosshair style={crosshairStyle} topOffset={0} bottomOffset={0} />
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>

      {key.groups.length > 0 || key.noLoad ? (
        <View style={styles.keyRow}>
          {key.groups.map((group) => (
            <View key={group} testID={`fitness-strip-key-${group}`} style={styles.keyItem}>
              <Icon
                name={sportFamilyIcon(group)}
                size={iconSize.sm}
                color={colorOf(group)}
                accessibilityLabel={t(sportFamilyLabel(group))}
              />
            </View>
          ))}
          {key.noLoad ? (
            <View
              testID="fitness-strip-key-noLoad"
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('fitness.noLoadKey')}
              style={[styles.keySwatch, styles.keyOutline, { borderColor: mutedColor }]}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

// The row the selected activity's pill sits in, which the pill reaches past
// through slop to the tap target.

const styles = StyleSheet.create({
  container: {},
  keyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  keyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  keySwatch: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  // The no-load key draws as its marks do, an outline with no fill.
  keyOutline: {
    borderWidth: stroke.two,
  },
  plotRow: {
    flexDirection: 'row',
  },
  chartWrapper: {
    position: 'relative',
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
});
