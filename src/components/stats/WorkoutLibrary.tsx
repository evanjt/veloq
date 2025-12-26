import React, { useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, opacity } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';

interface WorkoutStep {
  type: 'warmup' | 'work' | 'recovery' | 'cooldown';
  duration: number; // seconds
  intensity: number; // percentage of FTP or zone
  cadence?: number;
}

interface Workout {
  id: string;
  name: string;
  description: string;
  type: 'cycling' | 'running' | 'other';
  duration: number; // total seconds
  tss: number; // Training Stress Score
  steps: WorkoutStep[];
  tags: string[];
}

interface WorkoutLibraryProps {
  workouts?: Workout[];
  onSelectWorkout?: (workout: Workout) => void;
  athleteId?: string;
}

const STEP_COLORS = {
  warmup: '#4CAF50',
  work: '#FF5722',
  recovery: '#2196F3',
  cooldown: '#9C27B0',
};

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function WorkoutLibrary({
  workouts,
  onSelectWorkout,
  athleteId,
}: WorkoutLibraryProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const displayWorkouts = workouts || [];

  // Get unique tags for filtering
  const allTags = [...new Set(displayWorkouts.flatMap(w => w.tags))];

  const filteredWorkouts = selectedCategory
    ? displayWorkouts.filter(w => w.tags.includes(selectedCategory))
    : displayWorkouts;

  const openWorkoutsPage = () => {
    const url = athleteId
      ? `https://intervals.icu/athlete/${athleteId}/workouts`
      : 'https://intervals.icu';
    Linking.openURL(url);
  };

  // Show empty state if no workouts
  if (displayWorkouts.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Workout Library</Text>
          <TouchableOpacity onPress={openWorkoutsPage} style={styles.addButton}>
            <MaterialCommunityIcons name="open-in-new" size={16} color={isDark ? darkColors.textSecondary : colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            name="dumbbell"
            size={32}
            color={isDark ? darkColors.border : colors.textSecondary}
          />
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No workouts available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Create workouts on intervals.icu to see them here
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Workout Library</Text>
        <TouchableOpacity onPress={openWorkoutsPage} style={styles.addButton}>
          <MaterialCommunityIcons name="open-in-new" size={16} color={isDark ? darkColors.textSecondary : colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipContainer}
      >
        <TouchableOpacity
          style={[
            styles.chip,
            !selectedCategory && styles.chipActive,
            isDark && styles.chipDark,
          ]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text
            style={[
              styles.chipText,
              isDark && styles.textDark,
              !selectedCategory && styles.chipTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>
        {allTags.slice(0, 5).map(tag => (
          <TouchableOpacity
            key={tag}
            style={[
              styles.chip,
              selectedCategory === tag && styles.chipActive,
              isDark && styles.chipDark,
            ]}
            onPress={() => setSelectedCategory(tag === selectedCategory ? null : tag)}
          >
            <Text
              style={[
                styles.chipText,
                isDark && styles.textDark,
                selectedCategory === tag && styles.chipTextActive,
              ]}
            >
              {tag}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Workout list */}
      <View style={styles.workoutList}>
        {filteredWorkouts.map(workout => (
          <TouchableOpacity
            key={workout.id}
            style={[styles.workoutCard, isDark && styles.workoutCardDark]}
            onPress={() => onSelectWorkout?.(workout)}
            activeOpacity={0.8}
          >
            <View style={styles.workoutHeader}>
              <Text style={[styles.workoutName, isDark && styles.textLight]} numberOfLines={1}>
                {workout.name}
              </Text>
              <View style={styles.workoutMeta}>
                <Text style={[styles.workoutDuration, isDark && styles.textDark]}>
                  {formatDuration(workout.duration)}
                </Text>
                <Text style={[styles.workoutTss, { color: colors.primary }]}>
                  {workout.tss} TSS
                </Text>
              </View>
            </View>
            <Text style={[styles.workoutDesc, isDark && styles.textDark]} numberOfLines={1}>
              {workout.description}
            </Text>

            {/* Mini workout visualization */}
            <View style={styles.workoutPreview}>
              {workout.steps.map((step, idx) => {
                const widthPercent = (step.duration / workout.duration) * 100;
                const heightPercent = Math.min(step.intensity / 120, 1) * 100;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.stepBar,
                      {
                        width: `${widthPercent}%`,
                        height: `${heightPercent}%`,
                        backgroundColor: STEP_COLORS[step.type],
                      },
                    ]}
                  />
                );
              })}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
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
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  addButton: {
    padding: spacing.xs,
  },
  chipScroll: {
    marginBottom: spacing.md,
  },
  chipContainer: {
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: layout.borderRadius,
    paddingVertical: 6,
    borderRadius: spacing.md,
    backgroundColor: opacity.overlay.light,
    marginRight: spacing.xs,
  },
  chipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: colors.textOnDark,
  },
  workoutList: {
    gap: spacing.sm,
  },
  workoutCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    borderRadius: layout.borderRadius,
    padding: spacing.sm,
  },
  workoutCardDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  workoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  workoutName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  workoutMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workoutDuration: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  workoutTss: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
  workoutDesc: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  workoutPreview: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: opacity.overlay.light,
    borderRadius: spacing.xs,
    overflow: 'hidden',
  },
  stepBar: {
    minWidth: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
