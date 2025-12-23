import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Circle, Group } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { colors, spacing } from '@/theme';
import { getActivityColor } from '@/lib';
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
  onDateSelect?: (date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
}

interface DotData {
  x: number;
  date: string;
  activities: Array<{ id: string; name: string; type: ActivityType; load: number }>;
  fitness: number;
  fatigue: number;
  form: number;
}

export function ActivityDotsChart({
  data,
  activities = [],
  height = 40,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
}: ActivityDotsChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [selectedData, setSelectedData] = useState<DotData | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [chartWidth, setChartWidth] = useState(0);
  // Persisted activities after scrub ends (for tappable label)
  const [persistedActivities, setPersistedActivities] = useState<Array<{ id: string; name: string; type: ActivityType; load: number }> | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onDateSelectRef.current = onDateSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const touchX = useSharedValue(-1);
  const lastNotifiedIdx = useRef<number | null>(null);
  const externalSelectedIdx = useSharedValue(-1);
  const dataLengthShared = useSharedValue(0);
  const chartWidthShared = useSharedValue(0);

  // Build a map of activities by date
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; type: ActivityType; load: number }>>();
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

    const sorted = [...data].sort((a, b) => a.id.localeCompare(b.id));

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

  // Sync data length to shared value for worklets
  React.useEffect(() => {
    dataLengthShared.value = dotData.length;
  }, [dotData.length, dataLengthShared]);

  // Sync with external selectedDate
  React.useEffect(() => {
    if (selectedDate && dotData.length > 0 && !isActive) {
      const idx = dotData.findIndex(d => d.date === selectedDate);
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

  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = dataLengthShared.value;
    const width = chartWidthShared.value;
    if (touchX.value < 0 || width <= 0 || len === 0) return -1;

    const ratio = Math.max(0, Math.min(1, touchX.value / width));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, []);

  const updateTooltipOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || dotData.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setSelectedData(null);
          setIsActive(false);
          lastNotifiedIdx.current = null;
          if (onDateSelectRef.current) onDateSelectRef.current(null, null);
          if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
        }
        return;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) {
        setIsActive(true);
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
      }

      const point = dotData[idx];
      if (point) {
        setSelectedData(point);
        if (onDateSelectRef.current) {
          onDateSelectRef.current(point.date, {
            fitness: point.fitness,
            fatigue: point.fatigue,
            form: point.form,
          });
        }
      }
    },
    [dotData, isActive]
  );

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateTooltipOnJS)(idx);
    },
    [updateTooltipOnJS]
  );

  // Update shared selected index when this chart is being scrubbed
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (sharedSelectedIdx && idx >= 0) {
        sharedSelectedIdx.value = idx;
      }
    },
    [sharedSelectedIdx]
  );

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
      // Only react if this chart isn't being scrubbed (touchX < 0)
      if (touchX.value < 0 && idx !== prevIdx) {
        runOnJS(updateFromSharedIdx)(idx, prevIdx ?? -1);
      }
    },
    [updateFromSharedIdx]
  );

  // Called when pan starts - clear any persisted activities
  const onPanStart = useCallback(() => {
    setPersistedActivities(null);
  }, []);

  // Called when pan ends - persist activities if any
  const onPanEnd = useCallback(() => {
    if (selectedData && selectedData.activities.length > 0) {
      setPersistedActivities(selectedData.activities);
    }
  }, [selectedData]);

  const gesture = Gesture.Pan()
    .onStart((e) => {
      'worklet';
      touchX.value = e.x;
      runOnJS(onPanStart)();
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(onPanEnd)();
      touchX.value = -1;
    })
    .minDistance(0);

  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const len = dataLengthShared.value;
    const width = chartWidthShared.value;

    let idx = selectedIdx.value;
    if (idx < 0 && sharedSelectedIdx) {
      idx = sharedSelectedIdx.value;
    }
    if (idx < 0) {
      idx = externalSelectedIdx.value;
    }

    if (idx < 0 || len === 0 || width <= 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    const x = (idx / (len - 1)) * width;
    return {
      opacity: 1,
      transform: [{ translateX: x }],
    };
  }, [sharedSelectedIdx]);

  if (dotData.length === 0) {
    return null;
  }

  // Get activities to display:
  // - During scrub (this chart or other charts via sharedSelectedIdx): use selectedData
  // - After scrub ends: use persistedActivities
  const displayActivities = selectedData?.activities?.length
    ? selectedData.activities
    : (persistedActivities || []);

  // Get activity summary for display
  const getActivitySummary = (acts: typeof displayActivities) => {
    if (acts.length === 0) return null;
    if (acts.length === 1) {
      return acts[0].name;
    }
    return `${acts.length} activities`;
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

  const displayData = selectedData || (selectedDate ? dotData.find(d => d.date === selectedDate) : null);

  return (
    <View style={styles.container}>
      {/* Activity label when selected - tappable */}
      <View style={styles.labelContainer}>
        {displayActivities.length > 0 ? (
          <TouchableOpacity onPress={handleActivityTap} activeOpacity={0.7}>
            <Text style={[styles.activityLabel, styles.activityLabelTappable, isDark && styles.activityLabelDark]} numberOfLines={1}>
              {getActivitySummary(displayActivities)} →
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.noActivityLabel, isDark && styles.noActivityLabelDark]}>
            {displayData ? 'Rest day' : 'Activities'}
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
            <Text style={[styles.modalTitle, isDark && styles.textLight]}>Select Activity</Text>
            {displayActivities.map((activity) => (
              <TouchableOpacity
                key={activity.id}
                style={[styles.activityRow, isDark && styles.activityRowDark]}
                onPress={() => handleActivitySelect(activity.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.activityIcon, { backgroundColor: getActivityColor(activity.type) }]}>
                  <Text style={styles.activityIconText}>{getActivityEmoji(activity.type)}</Text>
                </View>
                <View style={styles.activityInfo}>
                  <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
                    {activity.name}
                  </Text>
                  {activity.load > 0 && (
                    <Text style={[styles.activityLoad, isDark && styles.textDark]}>
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
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <GestureDetector gesture={gesture}>
        <View
          style={[styles.chartWrapper, { height }]}
          onLayout={(e) => {
            const width = e.nativeEvent.layout.width;
            setChartWidth(width);
            chartWidthShared.value = width;
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

                  return (
                    <Circle
                      key={dot.date}
                      cx={x}
                      cy={y}
                      r={radius}
                      color={color}
                    />
                  );
                })}
              </Group>
            </Canvas>
          )}

          {/* Crosshair */}
          <Animated.View
            style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
            pointerEvents="none"
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  labelContainer: {
    height: 18,
    justifyContent: 'center',
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityLabelDark: {
    color: '#FFF',
  },
  noActivityLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  noActivityLabelDark: {
    color: '#888',
  },
  chartWrapper: {
    position: 'relative',
  },
  canvas: {
    flex: 1,
  },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  activityLabelTappable: {
    color: colors.primary,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.md,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: '#1E1E1E',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.xs,
  },
  activityRowDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
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
    fontSize: 14,
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityLoad: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cancelButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
