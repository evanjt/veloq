import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Circle, Group } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { router } from 'expo-router';
import { ChartCrosshair, useChartGestures } from '@/shared/charts';
import { colors, darkColors, opacity, spacing, layout, typography, chartStyles } from '@/theme';
import { getActivityColor, sortByDateId } from '@/features/activity/lib/activityUtils';
import type { Activity, ActivityType, WellnessData } from '@/types';

// Simple emoji icons for activity types
const ACTIVITY_EMOJIS: Record<string, string> = {
  Ride: '🚴',
  Run: '🏃',
  Swim: '🏊',
  Walk: '🚶',
  Hike: '🥾',
  VirtualRide: '🚴',
  VirtualRun: '🏃',
  Workout: '💪',
  WeightTraining: '🏋️',
  Yoga: '🧘',
  Other: '❤️',
};

const getActivityEmoji = (type: ActivityType): string => {
  return ACTIVITY_EMOJIS[type] || '❤️';
};

interface ActivityDotsChartProps {
  /** Wellness data for date alignment */
  data: WellnessData[];
  /** Activities to display as dots */
  activities?: Activity[];
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
  activities: {
    id: string;
    name: string;
    type: ActivityType;
    load: number;
  }[];
  fitness: number;
  fatigue: number;
  form: number;
}

export const ActivityDotsChart = React.memo(function ActivityDotsChart({
  data,
  activities = [],
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
  // Persisted activities after scrub ends (for tappable label)
  const [persistedActivities, setPersistedActivities] = useState<
    | {
        id: string;
        name: string;
        type: ActivityType;
        load: number;
      }[]
    | null
  >(null);
  const [showPicker, setShowPicker] = useState(false);
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const selectedDataRef = useRef<DotData | null>(null);
  const externalSelectedIdx = useSharedValue(-1);

  // Build a map of activities by date
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: ActivityType; load: number }[]>();
    for (const activity of activities) {
      const date = activity.start_date_local?.split('T')[0];
      if (!date) continue;

      if (!map.has(date)) {
        map.set(date, []);
      }
      map.get(date)!.push({
        id: activity.id,
        name: activity.name,
        type: activity.type,
        load: activity.icu_training_load || 0,
      });
    }
    return map;
  }, [activities]);

  // Process wellness data and match with activities
  const dotData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const sorted = sortByDateId(data);

    return sorted.map((day, idx) => {
      const fitnessRaw = day.ctl ?? day.ctlLoad ?? 0;
      const fatigueRaw = day.atl ?? day.atlLoad ?? 0;
      const fitness = Math.round(fitnessRaw);
      const fatigue = Math.round(fatigueRaw);
      const dayActivities = activitiesByDate.get(day.id) || [];

      return {
        x: idx,
        date: day.id,
        activities: dayActivities,
        fitness,
        fatigue,
        form: fitness - fatigue,
      };
    });
  }, [data, activitiesByDate]);

  const handleSelect = useCallback((point: DotData) => {
    selectedDataRef.current = point;
    setSelectedData(point);
    setPersistedActivities(null);
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
      setPersistedActivities(null);
      return;
    }
    const last = selectedDataRef.current;
    if (last?.activities.length) setPersistedActivities(last.activities);
    selectedDataRef.current = null;
    setSelectedData(null);
    onDateSelectRef.current?.(null, null);
  }, []);

  const { gesture, isActive, crosshairX, crosshairStyle, syncBounds, syncXCoords } =
    useChartGestures<DotData>({
      data: dotData,
      onSelect: handleSelect,
      onInteractionChange: handleInteractionChange,
      sharedSelectedIdx,
      externalSelectedIdx,
      crosshairMode: 'finger',
    });

  // Sync with external selectedDate
  React.useEffect(() => {
    if (selectedDate && dotData.length > 0 && !isActive) {
      const idx = dotData.findIndex((d) => d.date === selectedDate);
      if (idx >= 0) {
        setSelectedData(dotData[idx]);
        externalSelectedIdx.value = idx;
      }
    } else if (!selectedDate && !isActive) {
      // When selectedDate clears (scrub ended on another chart), persist activities
      if (selectedData?.activities?.length) {
        setPersistedActivities(selectedData.activities);
      }
      setSelectedData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, dotData, isActive, externalSelectedIdx, selectedData]);

  // Dots sit on an even split of the width, so the crosshair can land on one
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
            setPersistedActivities(prevPoint.activities);
          }
        }
        setSelectedData(null);
        return;
      }

      const point = dotData[idx];
      if (point) {
        setSelectedData(point);
        // Clear persisted when actively scrubbing
        setPersistedActivities(null);
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
  const displayActivities = selectedData?.activities?.length
    ? selectedData.activities
    : persistedActivities || [];

  // Get activity summary for display
  const getActivitySummary = (acts: typeof displayActivities) => {
    if (acts.length === 0) return null;
    if (acts.length === 1) {
      return acts[0].name;
    }
    return t('fitness.activitiesCount', { count: acts.length });
  };

  // Handle tap on activity label
  const handleActivityTap = useCallback(() => {
    if (displayActivities.length === 0) return;

    if (displayActivities.length === 1) {
      // Single activity - navigate directly
      router.push(`/activity/${displayActivities[0].id}`);
      setPersistedActivities(null);
    } else {
      // Multiple activities - show picker
      setShowPicker(true);
    }
  }, [displayActivities]);

  // Handle activity selection from picker
  const handleActivitySelect = useCallback((activityId: string) => {
    setShowPicker(false);
    setPersistedActivities(null);
    router.push(`/activity/${activityId}`);
  }, []);

  // Below every hook, so the hook count stays fixed across renders.
  if (dotData.length === 0) {
    return null;
  }

  const displayData =
    selectedData || (selectedDate ? dotData.find((d) => d.date === selectedDate) : null);

  // Get activity color for the pill - use first activity's type color
  const activityPillColor =
    displayActivities.length > 0 ? getActivityColor(displayActivities[0].type) : colors.primary;

  return (
    <View style={styles.container}>
      {/* Activity label when selected - tappable, styled as pill with activity color */}
      <View style={styles.labelContainer}>
        {displayActivities.length > 0 ? (
          <TouchableOpacity onPress={handleActivityTap} activeOpacity={0.7}>
            <View
              style={[
                styles.activityPill,
                {
                  backgroundColor: `${activityPillColor}20`,
                  borderColor: `${activityPillColor}40`,
                },
                isDark && {
                  backgroundColor: `${activityPillColor}30`,
                  borderColor: `${activityPillColor}50`,
                },
              ]}
            >
              <Text
                style={[styles.activityPillText, { color: activityPillColor }]}
                numberOfLines={1}
              >
                {getActivitySummary(displayActivities)} →
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.noActivityLabel, isDark && styles.noActivityLabelDark]}>
            {displayData ? t('fitness.restDay') : t('navigation.activities')}
          </Text>
        )}
      </View>

      {/* Activity picker modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowPicker(false)}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <Text style={[styles.modalTitle, isDark && styles.textLight]}>
              {t('fitness.selectActivity')}
            </Text>
            {displayActivities.map((activity) => (
              <TouchableOpacity
                key={activity.id}
                style={[styles.activityRow, isDark && styles.activityRowDark]}
                onPress={() => handleActivitySelect(activity.id)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.activityIcon,
                    { backgroundColor: getActivityColor(activity.type) },
                  ]}
                >
                  <Text style={styles.activityIconText}>{getActivityEmoji(activity.type)}</Text>
                </View>
                <View style={styles.activityInfo}>
                  <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
                    {activity.name}
                  </Text>
                  {activity.load > 0 && (
                    <Text style={[styles.activityLoad, isDark && chartStyles.textDark]}>
                      {Math.round(activity.load)} TSS
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowPicker(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <GestureDetector gesture={gesture}>
        <View
          style={[styles.chartWrapper, { height }]}
          onLayout={(e) => {
            setChartWidth(e.nativeEvent.layout.width);
          }}
        >
          {chartWidth > 0 && (
            <Canvas style={styles.canvas}>
              <Group>
                {dotData.map((dot, idx) => {
                  if (dot.activities.length === 0) return null;

                  const x = (idx / (dotData.length - 1 || 1)) * chartWidth;
                  const y = height / 2;
                  // Size based on number of activities
                  const radius = Math.min(6, 3 + dot.activities.length);
                  // Use first activity's color
                  const color = getActivityColor(dot.activities[0].type);

                  return <Circle key={dot.date} cx={x} cy={y} r={radius} color={color} />;
                })}
              </Group>
            </Canvas>
          )}

          {/* Crosshair */}
          <ChartCrosshair style={crosshairStyle} topOffset={0} bottomOffset={0} />
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  labelContainer: {
    height: 24,
    justifyContent: 'center',
  },
  activityPill: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: 1,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: opacity.overlay.heavy,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  textLight: {
    color: colors.textOnDark,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    marginBottom: spacing.xs,
  },
  activityRowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  activityIconText: {
    fontSize: typography.bodySmall.fontSize,
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityLoad: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cancelButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
});
