import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { ChartCrosshair, useChartGestures } from '@/shared/charts';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { sortByDateId } from '@/shared/activity/activityUtils';
import { ACTIVITY_CATEGORIES, getActivityCategory } from '@/shared/activity/sportCategories';
import type { DayLoad } from 'veloqrs';
import type { Activity, WellnessData } from '@/types';
import { stripMarks, stripKey, markFills } from '../lib/stripMarks';
import { dayLoadReadout } from '../lib/dayLoadReadout';
import { dayPillTone, groupColor } from '../lib/dayPillTone';
import { formFromLoads } from '@/shared/math';
import { formatShortDate } from '@/shared/format/format';
import { Row } from '@/shared/ui';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { DayActivitiesInput } from '@/app/sheets/day-activities';
import { tapTo } from '@/shared/app/navigation';

interface ActivityDotsChartProps {
  /** Wellness data for date alignment */
  data: WellnessData[];
  /** Activities to display as dots */
  activities?: Activity[];
  /** Recorded activity load per local day, from the engine. */
  dailyLoads?: DayLoad[];
  height?: number;
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
  activities: DayActivitiesInput['activities'];
  fitness: number;
  fatigue: number;
  form: number;
}

export const ActivityDotsChart = React.memo(function ActivityDotsChart({
  data,
  activities = [],
  dailyLoads,
  height = 40,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: ActivityDotsChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [selectedData, setSelectedData] = useState<DotData | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  // The day and its activities after a scrub ends, for the tappable label
  // and the load readout beside it.
  const [persisted, setPersisted] = useState<{
    date: string;
    activities: DotData['activities'];
  } | null>(null);
  const persistedActivities = persisted?.activities ?? null;
  const openSheet = useSheetOpener();
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const selectedDataRef = useRef<DotData | null>(null);
  const externalSelectedIdx = useSharedValue(-1);

  // Build a map of activities by date
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, DayActivitiesInput['activities']>();
    for (const activity of activities) {
      const date = activity.start_date_local?.split('T')[0];
      if (!date) continue;

      let onDay = map.get(date);
      if (!onDay) {
        onDay = [];
        map.set(date, onDay);
      }
      onDay.push({
        id: activity.id,
        name: activity.name,
        type: activity.type,
        load: activity.icu_training_load || 0,
        startDateLocal: activity.start_date_local,
        movingTime: activity.moving_time,
        distance: activity.distance,
      });
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
    setSelectedData(point);
    setPersisted(null);
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.form,
    });
  }, []);

  // On release the activities stay on screen so the label remains tappable.
  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (active) {
      setPersisted(null);
      return;
    }
    const last = selectedDataRef.current;
    if (last?.activities.length) setPersisted({ date: last.date, activities: last.activities });
    selectedDataRef.current = null;
    setSelectedData(null);
    onDateSelectRef.current?.(null, null);
  }, []);

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

  const {
    gesture,
    isActive,
    crosshairX,
    crosshairStyle,
    syncBounds,
    syncXCoords,
    accessibilityProps,
  } = useChartGestures<DotData>({
    data: dotData,
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
    sharedSelectedIdx,
    externalSelectedIdx,
    crosshairMode: 'finger',
    describePoint,
  });

  // Sync with external selectedDate
  React.useEffect(() => {
    if (selectedDate && dotData.length > 0 && !isActive) {
      const idx = dotData.findIndex((d) => d.date === selectedDate);
      if (idx >= 0) {
        setSelectedData(dotData[idx]);
        externalSelectedIdx.value = idx;
      } else {
        // A pinned day with no row stands for no activities, not the last day's.
        setSelectedData(null);
        setPersisted(null);
        externalSelectedIdx.value = -1;
      }
    } else if (!selectedDate && !isActive) {
      // When selectedDate clears (scrub ended on another chart), persist activities
      if (selectedData?.activities?.length) {
        setPersisted({ date: selectedData.date, activities: selectedData.activities });
      }
      setSelectedData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, dotData, isActive, externalSelectedIdx, selectedData]);

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

  // React to shared index changes from OTHER charts (when not scrubbing this chart)
  const updateFromSharedIdx = useCallback(
    (idx: number, prevIdx: number) => {
      if (idx < 0 || dotData.length === 0) {
        // Scrub on other chart ended - persist activities if we had any
        if (prevIdx >= 0 && prevIdx < dotData.length) {
          const prevPoint = dotData[prevIdx];
          if (prevPoint?.activities?.length > 0) {
            setPersisted({ date: prevPoint.date, activities: prevPoint.activities });
          }
        }
        setSelectedData(null);
        return;
      }

      const point = dotData[idx];
      if (point) {
        setSelectedData(point);
        // Clear persisted when actively scrubbing
        setPersisted(null);
      }
    },
    [dotData]
  );

  useAnimatedReaction(
    () => sharedSelectedIdx?.value ?? -1,
    (idx, prevIdx) => {
      // Only react while this chart is not the one being scrubbed.
      if (crosshairX.value < 0 && idx !== prevIdx) {
        runOnJS(updateFromSharedIdx)(idx, prevIdx ?? -1);
      }
    },
    [updateFromSharedIdx, crosshairX]
  );

  // Get activities to display:
  // - During scrub (this chart or other charts via sharedSelectedIdx): use selectedData
  // - After scrub ends: use persistedActivities
  // Memoised so the empty fallback is one array rather than a fresh one each
  // render, which changed the summary callback's identity on every frame of a
  // scrub.
  const displayActivities = useMemo(
    () => (selectedData?.activities?.length ? selectedData.activities : persistedActivities || []),
    [selectedData, persistedActivities]
  );

  const getActivitySummary = (acts: typeof displayActivities) => {
    if (acts.length === 0) return null;
    if (acts.length === 1) {
      return acts[0].name;
    }
    return t('fitness.activitiesCount', { count: acts.length });
  };

  // Handle tap on activity label
  const handleActivityTap = useCallback(async () => {
    if (displayActivities.length === 0) return;

    if (displayActivities.length === 1) {
      // Single activity - navigate directly
      tapTo(`/activity/${displayActivities[0].id}`);
      setPersisted(null);
      return;
    }
    // Multiple activities - choose one in a sheet
    const result = await openSheet<DayActivitiesInput, string>('sheets/day-activities', {
      activities: displayActivities,
    });
    if (result.kind !== 'selected') return;
    setPersisted(null);
    tapTo(`/activity/${result.value}`);
  }, [displayActivities, openSheet]);

  // Below every hook, so the hook count stays fixed across renders.
  if (dotData.length === 0) {
    return null;
  }

  const displayData =
    selectedData || (selectedDate ? dotData.find((d) => d.date === selectedDate) : null);

  // The day the label stands for: the selection, or the one a released scrub
  // left its activities on.
  const readoutDate = displayData?.date ?? persisted?.date ?? null;
  const readout = readoutDate ? dayLoadReadout(loadByDate.get(readoutDate)) : null;

  // The pill takes the first activity's sport group colour, as its mark does.
  const firstActivity = displayActivities[0];
  const pillTone = dayPillTone(
    firstActivity ? getActivityCategory(firstActivity.type) : undefined,
    isDark
  );

  const mutedColor = isDark ? darkColors.textDisabled : colors.textDisabled;
  const keyTextStyle = [styles.keyText, isDark && styles.noActivityLabelDark];

  const dayLoad = readout ? (
    <Text
      testID="fitness-day-load"
      style={[styles.dayLoad, isDark && styles.noActivityLabelDark]}
      numberOfLines={1}
    >
      {t('metrics.trainingLoad')}{' '}
      {readout.total === null ? t('fitness.loadUnavailable') : readout.total}
      {readout.status === 'partial' ? ` ${t('fitness.loadPartial')}` : ''}
    </Text>
  ) : null;

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={[styles.stripTitle, isDark && styles.stripTitleDark]}>
        {t('fitness.daysTrained')}
      </Text>

      {displayActivities.length > 0 ? (
        <Row
          inset="none"
          behaviour="navigate"
          onPress={handleActivityTap}
          accessibilityLabel={getActivitySummary(displayActivities) ?? t('fitness.selectActivity')}
          accessory={dayLoad}
        >
          <View
            style={[
              styles.labelBox,
              { backgroundColor: pillTone.fill, borderColor: pillTone.border },
            ]}
          >
            <Text style={[styles.activityPillText, { color: pillTone.ink }]} numberOfLines={1}>
              {getActivitySummary(displayActivities)}
            </Text>
          </View>
        </Row>
      ) : (
        <Row inset="none" accessory={dayLoad}>
          {/* The same box as the pill, so the row keeps its height across a scrub. */}
          <View style={[styles.labelBox, styles.restBox]}>
            <Text style={[styles.noActivityLabel, isDark && styles.noActivityLabelDark]}>
              {displayData ? t('fitness.restDay') : t('navigation.activities')}
            </Text>
          </View>
        </Row>
      )}

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
                  let top = height - total;
                  return markFills(mark, mutedColor, groupColor).map((fill, n) => {
                    const y = top;
                    const fillHeight = fill.fraction * total;
                    top += fillHeight;
                    return (
                      <Rect
                        key={`${mark.dates[0]}-${n}`}
                        x={mark.x}
                        y={y}
                        width={mark.width}
                        height={fillHeight}
                        color={fill.color}
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

      {key.groups.length > 0 || key.noLoad ? (
        <View>
          <View style={styles.keyRow}>
            {key.groups.map((group) => (
              <View key={group} testID={`fitness-strip-key-${group}`} style={styles.keyItem}>
                <View style={[styles.keySwatch, { backgroundColor: groupColor(group) }]} />
                <Text style={keyTextStyle}>
                  {t(
                    `maps.activityTypes.${ACTIVITY_CATEGORIES[group]?.labelKey ?? 'other'}` as 'maps.activityTypes.ride'
                  )}
                </Text>
              </View>
            ))}
            {key.noLoad ? (
              <View testID="fitness-strip-key-noLoad" style={styles.keyItem}>
                <View style={[styles.keySwatch, { backgroundColor: mutedColor }]} />
                <Text style={keyTextStyle}>{t('fitness.noLoadKey')}</Text>
              </View>
            ) : null}
          </View>
          <Text testID="fitness-strip-gloss" style={keyTextStyle}>
            {t('fitness.stripGloss')}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

// The row the selected activity's pill sits in, which the pill reaches past
// through slop to the tap target.

const styles = StyleSheet.create({
  container: {},
  stripTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  stripTitleDark: {
    color: darkColors.textPrimary,
  },
  keyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  keyText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  dayLoad: {
    flexShrink: 1,
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  labelBox: {
    flexShrink: 1,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: 1,
  },
  restBox: {
    paddingHorizontal: 0,
    borderColor: colors.transparent,
  },
  activityPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  noActivityLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  noActivityLabelDark: {
    color: darkColors.textSecondary,
  },
  chartWrapper: {
    position: 'relative',
  },
  canvas: {
    flex: 1,
  },
});
