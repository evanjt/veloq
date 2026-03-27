import React, { useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useExerciseSets } from '@/hooks/activities';
import { useTheme } from '@/hooks';
import { useMetricSystem } from '@/hooks/ui/useMetricSystem';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { ExerciseSet } from 'veloqrs';

interface ExerciseTableProps {
  activityId: string;
  activityType: string;
}

interface ExerciseGroup {
  name: string;
  sets: ExerciseSet[];
}

function groupExercises(sets: ExerciseSet[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  let current: ExerciseGroup | null = null;

  for (const set of sets) {
    // Skip rest sets — they're gaps between exercises
    if (set.setType !== 0) continue;

    if (!current || current.name !== set.displayName) {
      current = { name: set.displayName, sets: [] };
      groups.push(current);
    }
    current.sets.push(set);
  }

  return groups;
}

function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) {
    return kg % 1 === 0 ? `${kg} kg` : `${kg.toFixed(1)} kg`;
  }
  const lbs = kg * 2.20462;
  return lbs % 1 === 0 ? `${lbs} lbs` : `${lbs.toFixed(1)} lbs`;
}

export function ExerciseTable({ activityId, activityType }: ExerciseTableProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { data: exerciseSets, isLoading } = useExerciseSets(activityId, activityType);

  const groups = useMemo(() => {
    if (!exerciseSets || exerciseSets.length === 0) return [];
    return groupExercises(exerciseSets);
  }, [exerciseSets]);

  if (isLoading) {
    return (
      <View style={[styles.card, isDark && styles.cardDark, styles.loadingContainer]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.loadingText, isDark && styles.textSecondaryDark]}>
          Loading exercises...
        </Text>
      </View>
    );
  }

  if (groups.length === 0) return null;

  const totalSets = groups.reduce((sum, g) => sum + g.sets.length, 0);

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textDark]}>Exercises</Text>
        <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
          {groups.length} exercises · {totalSets} sets
        </Text>
      </View>

      {groups.map((group, groupIdx) => (
        <View key={`${group.name}-${groupIdx}`}>
          {groupIdx > 0 && <View style={[styles.divider, isDark && styles.dividerDark]} />}
          <Text style={[styles.exerciseName, isDark && styles.textDark]}>{group.name}</Text>

          {/* Column headers */}
          <View style={styles.headerRow}>
            <Text style={[styles.colHeader, styles.colSet, isDark && styles.textSecondaryDark]}>
              Set
            </Text>
            <Text style={[styles.colHeader, styles.colReps, isDark && styles.textSecondaryDark]}>
              Reps
            </Text>
            <Text style={[styles.colHeader, styles.colWeight, isDark && styles.textSecondaryDark]}>
              Weight
            </Text>
            <Text style={[styles.colHeader, styles.colTime, isDark && styles.textSecondaryDark]}>
              Time
            </Text>
          </View>

          {group.sets.map((set, setIdx) => (
            <View
              key={set.setOrder}
              style={[
                styles.setRow,
                setIdx > 0 && styles.setRowBorder,
                setIdx > 0 && isDark && styles.setRowBorderDark,
              ]}
            >
              <Text style={[styles.colValue, styles.colSet, isDark && styles.textDark]}>
                {setIdx + 1}
              </Text>
              <Text style={[styles.colValue, styles.colReps, isDark && styles.textDark]}>
                {set.repetitions != null ? set.repetitions : '--'}
              </Text>
              <Text style={[styles.colValue, styles.colWeight, isDark && styles.textDark]}>
                {set.weightKg != null ? formatWeight(set.weightKg, isMetric) : '--'}
              </Text>
              <Text style={[styles.colValue, styles.colTime, isDark && styles.textSecondaryDark]}>
                {set.durationSecs != null ? formatDuration(set.durationSecs) : '--'}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: spacing.sm,
  },
  dividerDark: {
    backgroundColor: '#333333',
  },
  headerRow: {
    flexDirection: 'row',
    paddingBottom: 4,
  },
  setRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  setRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E5',
  },
  setRowBorderDark: {
    borderTopColor: '#333333',
  },
  colHeader: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  colValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  colSet: {
    width: 36,
    textAlign: 'center',
  },
  colReps: {
    width: 50,
    textAlign: 'center',
  },
  colWeight: {
    flex: 1,
    textAlign: 'right',
    paddingRight: spacing.md,
  },
  colTime: {
    width: 60,
    textAlign: 'right',
  },
  textDark: {
    color: darkColors.textPrimary,
  },
  textSecondaryDark: {
    color: darkColors.textSecondary,
  },
});
