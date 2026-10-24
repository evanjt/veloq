import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme, useMetricSystem } from '@/shared/app';
import { colors, darkColors, spacing, layout, bodyDiagram, typography, stroke } from '@/theme';
import type { MuscleVolume, ExerciseSummary } from '@/types';
import { formatWeightRounded as formatWeight } from '@/shared/format/weight';
import { Row } from '@/shared/ui';

import { muscleName } from '../lib/muscleNames';
import { navigateTo } from '@/shared/app/navigation';
import { NameText } from '@/shared/ui/NameText';

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
  const roles = bodyDiagram[isDark ? 'dark' : 'light'];
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const selectedMuscleName = muscleName(selectedVolume.slug, t);

  return (
    <View testID="strength-exercise-list">
      <Text style={[styles.title, isDark && styles.titleDark]}>
        {t('strength.exercisesTargeting', { muscle: selectedMuscleName })}
      </Text>
      {exerciseSummary.exercises.map((exercise, index) => (
        <View
          key={exercise.exerciseCategory}
          style={[index > 0 && styles.itemBorder, index > 0 && isDark && styles.itemBorderDark]}
        >
          <Row
            inset="none"
            behaviour="navigate"
            onPress={() => navigateTo(`/exercise/${exercise.exerciseCategory}`)}
            accessibilityLabel={t('strength.openExerciseHistory', {
              exercise: exercise.exerciseName,
            })}
            testID={`exercise-history-${exercise.exerciseCategory}`}
          >
            <View style={[styles.dot, { backgroundColor: roles.primary }]} />
            <View style={styles.content}>
              <NameText style={[styles.name, isDark && styles.nameDark]}>
                {exercise.exerciseName}
              </NameText>
              <Text style={[styles.meta, isDark && styles.metaDark]}>
                {t('strength.setsCount', { count: exercise.totalSets })} ·{' '}
                {t('strength.exerciseWorkoutCount', { count: exercise.activityCount })}
                {` · ${t('strength.repsCount', { count: exercise.totalReps })}`}
                {exercise.volumeKg > 0 ? ` · ${formatWeight(exercise.volumeKg, isMetric)}` : ''}
              </Text>
            </View>
          </Row>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  title: {
    ...typography.bodyCompactBold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  titleDark: { color: darkColors.textSecondary },
  itemBorder: { borderTopWidth: stroke.hairline, borderTopColor: colors.border },
  itemBorderDark: { borderTopColor: darkColors.border },
  dot: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
  },
  content: { flex: 1 },
  name: { ...typography.bodyMedium, color: colors.textPrimary },
  nameDark: { color: darkColors.textPrimary },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  metaDark: { color: darkColors.textSecondary },
});
