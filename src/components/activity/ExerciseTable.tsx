import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Pressable, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { useExerciseSets } from '@/hooks/activities';
import { useMetricSystem } from '@/hooks/ui/useMetricSystem';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, layout, opacity } from '@/theme';
import type { ExerciseSet } from 'veloqrs';

interface ExerciseTableProps {
  activityId: string;
  activityType: string;
  isDark: boolean;
  athleteSex?: string;
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

export function ExerciseTable({
  activityId,
  activityType,
  isDark,
  athleteSex,
}: ExerciseTableProps) {
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

      {/* Footer: citation + gender note */}
      <View style={[styles.footerDivider, isDark && styles.footerDividerDark]} />
      <View style={styles.footer}>
        <Pressable
          onPress={() => Linking.openURL('https://github.com/yuhonas/free-exercise-db')}
          hitSlop={8}
        >
          <Text style={[styles.footerText, isDark && styles.textSecondaryDark]}>
            Muscle data: free-exercise-db
          </Text>
        </Pressable>
        {athleteSex !== 'M' && athleteSex !== 'F' && (
          <Text style={[styles.footerText, isDark && styles.textSecondaryDark]}>
            Body chosen at random — no gender in profile
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
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
    borderTopColor: colors.divider,
  },
  setRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  colHeader: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  footerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  footerDividerDark: {
    backgroundColor: darkColors.border,
  },
  footer: {
    gap: 2,
  },
  footerText: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.6,
  },
});
