import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { useTheme, useMetricSystem } from '@/shared/app';
import { colors, darkColors, spacing, layout, brand, typography } from '@/theme';
import type { MuscleVolume, ExerciseSummary } from '@/types';
import { formatWeightRounded as formatWeight } from '@/shared/format/weight';

import { muscleName } from '../lib/muscleNames';

interface StrengthExerciseListProps {
  selectedVolume: MuscleVolume;
  exerciseSummary: { exercises: ExerciseSummary[] };
}

/** Exercises behind one muscle, each opening its history. */
export const StrengthExerciseList = React.memo(function StrengthExerciseList({
  selectedVolume,
  exerciseSummary,
}: StrengthExerciseListProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const router = useRouter();
  const selectedMuscleName = muscleName(selectedVolume.slug, t);

  return (
    <View testID="strength-exercise-list">
      <Text style={[styles.title, isDark && styles.titleDark]}>
        {t('strength.exercisesTargeting', { muscle: selectedMuscleName })}
      </Text>
      {exerciseSummary.exercises.map((exercise, index) => (
        <TouchableOpacity
          key={exercise.exerciseCategory}
          style={[
            styles.item,
            index > 0 && styles.itemBorder,
            index > 0 && isDark && styles.itemBorderDark,
          ]}
          onPress={() => router.push(`/exercise/${exercise.exerciseCategory}`)}
          accessibilityRole="link"
          accessibilityLabel={t('strength.openExerciseHistory', {
            exercise: exercise.exerciseName,
          })}
          testID={`exercise-history-${exercise.exerciseCategory}`}
          activeOpacity={0.7}
        >
          <View style={styles.dot} />
          <View style={styles.content}>
            <Text style={[styles.name, isDark && styles.nameDark]} numberOfLines={1}>
              {exercise.exerciseName}
            </Text>
            <Text style={[styles.meta, isDark && styles.metaDark]}>
              {t('strength.exerciseSets', { sets: exercise.totalSets })} ·{' '}
              {t('strength.exerciseWorkoutCount', { count: exercise.activityCount })}
              {` · ${exercise.totalReps} ${t('strength.reps')}`}
              {exercise.volumeKg > 0 ? ` · ${formatWeight(exercise.volumeKg, isMetric)}` : ''}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  title: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  titleDark: { color: darkColors.textSecondary },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xsPlus,
    gap: spacing.sm,
  },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  itemBorderDark: { borderTopColor: darkColors.border },
  dot: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: brand.tealLight,
  },
  content: { flex: 1 },
  name: { fontSize: typography.bodyMedium.fontSize, color: colors.textPrimary },
  nameDark: { color: darkColors.textPrimary },
  meta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  metaDark: { color: darkColors.textSecondary },
});
