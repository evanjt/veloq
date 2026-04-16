import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useTheme, useMetricSystem } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { colors, darkColors, spacing, layout, brand } from '@/theme';
import type { MuscleVolume, ExerciseSummary } from '@/types';

function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) return `${Math.round(kg)} kg`;
  return `${Math.round(kg * 2.20462)} lbs`;
}

interface ExerciseActivity {
  activityId: string;
  activityName: string;
  date: number;
  sets: number;
  totalWeightKg: number;
}

interface StrengthExerciseListProps {
  selectedVolume: MuscleVolume;
  exerciseSummary: { exercises: ExerciseSummary[] };
  expandedExercise: number | null;
  exerciseActivities: ExerciseActivity[] | null;
  onExpandExercise: (exerciseCategory: number | null) => void;
}

export const StrengthExerciseList = React.memo(function StrengthExerciseList({
  selectedVolume,
  exerciseSummary,
  expandedExercise,
  exerciseActivities,
  onExpandExercise,
}: StrengthExerciseListProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const router = useRouter();

  return (
    <View style={[styles.exerciseCard, isDark && styles.exerciseCardDark]}>
      <Text style={[styles.exerciseCardTitle, isDark && styles.exerciseCardTitleDark]}>
        {t('strength.exercisesTargeting', {
          muscle: MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug,
        })}
      </Text>
      {exerciseSummary.exercises.map((exercise: ExerciseSummary, idx: number) => {
        const isExpanded = expandedExercise === exercise.exerciseCategory;
        return (
          <View key={exercise.exerciseCategory}>
            <TouchableOpacity
              style={[
                styles.exerciseCardItem,
                idx > 0 && styles.exerciseCardItemBorder,
                idx > 0 && isDark && styles.exerciseCardItemBorderDark,
              ]}
              onPress={() => onExpandExercise(isExpanded ? null : exercise.exerciseCategory)}
              activeOpacity={0.7}
            >
              <View style={styles.exerciseCardDot} />
              <View style={styles.exerciseCardContent}>
                <View style={styles.exerciseCardNameRow}>
                  <Text
                    style={[styles.exerciseCardName, isDark && styles.exerciseCardNameDark]}
                    numberOfLines={1}
                  >
                    {exercise.exerciseName}
                  </Text>
                  <MaterialCommunityIcons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                </View>
                <Text style={[styles.exerciseCardMeta, isDark && styles.exerciseCardMetaDark]}>
                  {t('strength.exerciseSets', {
                    sets: exercise.totalSets,
                  })}{' '}
                  ·{' '}
                  {t('strength.exerciseWorkoutCount', {
                    count: exercise.activityCount,
                  })}
                  {exercise.totalWeightKg > 0
                    ? ` · ${formatWeight(exercise.totalWeightKg, isMetric)}`
                    : ''}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Expanded: per-activity breakdown */}
            {isExpanded && exerciseActivities && exerciseActivities.length > 0 && (
              <View style={[styles.activityList, isDark && styles.activityListDark]}>
                {exerciseActivities.map((activity) => (
                  <TouchableOpacity
                    key={activity.activityId}
                    style={styles.activityRow}
                    onPress={() => router.push(`/activity/${activity.activityId}`)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.activityRowLeft}>
                      <Text
                        style={[styles.activityName, isDark && styles.activityNameDark]}
                        numberOfLines={1}
                      >
                        {activity.activityName}
                      </Text>
                      <Text style={[styles.activityDate, isDark && styles.activityDateDark]}>
                        {new Date(activity.date * 1000).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                    <Text style={[styles.activityStats, isDark && styles.activityStatsDark]}>
                      {t('strength.exerciseSets', {
                        sets: activity.sets,
                      })}
                      {activity.totalWeightKg > 0
                        ? ` · ${formatWeight(activity.totalWeightKg, isMetric)}`
                        : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {isExpanded && exerciseActivities && exerciseActivities.length === 0 && (
              <View style={[styles.activityList, isDark && styles.activityListDark]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  exerciseCardDark: {
    backgroundColor: darkColors.surface,
  },
  exerciseCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  exerciseCardTitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  exerciseCardItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  exerciseCardItemBorderDark: {
    borderTopColor: darkColors.border,
  },
  exerciseCardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: brand.orange,
  },
  exerciseCardContent: {
    flex: 1,
  },
  exerciseCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseCardName: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  exerciseCardNameDark: {
    color: darkColors.textPrimary,
  },
  exerciseCardMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  exerciseCardMetaDark: {
    color: darkColors.textSecondary,
  },
  activityList: {
    marginLeft: 14,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
    marginBottom: spacing.xs,
  },
  activityListDark: {
    borderLeftColor: darkColors.border,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
  },
  activityRowLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  activityName: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  activityNameDark: {
    color: darkColors.textPrimary,
  },
  activityDate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  activityDateDark: {
    color: darkColors.textSecondary,
  },
  activityStats: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  activityStatsDark: {
    color: darkColors.textSecondary,
  },
});
