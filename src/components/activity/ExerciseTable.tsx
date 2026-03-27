import React, { useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator, Pressable, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useExerciseSets } from '@/hooks/activities';
import { useMetricSystem } from '@/hooks/ui/useMetricSystem';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
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
  const { t } = useTranslation();
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
      </View>
    );
  }

  if (groups.length === 0) return null;

  const totalSets = groups.reduce((sum, g) => sum + g.sets.length, 0);
  const hasGender = athleteSex === 'M' || athleteSex === 'F';
  const genderLabel = athleteSex === 'F' ? 'female' : 'male';

  return (
    <>
      {/* Exercise card */}
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textDark]}>
            {t('activityDetail.exercises')}
          </Text>
          <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
            {t('activityDetail.exercisesSummary', {
              exercises: groups.length,
              sets: totalSets,
            })}
          </Text>
        </View>

        {groups.map((group, groupIdx) => (
          <View key={`${group.name}-${groupIdx}`}>
            {groupIdx > 0 && <View style={[styles.divider, isDark && styles.dividerDark]} />}
            <Text style={[styles.exerciseName, isDark && styles.textDark]}>{group.name}</Text>

            <View style={styles.headerRow}>
              <Text style={[styles.colHeader, styles.colSet, isDark && styles.textSecondaryDark]}>
                Set
              </Text>
              <Text style={[styles.colHeader, styles.colReps, isDark && styles.textSecondaryDark]}>
                Reps
              </Text>
              <Text
                style={[styles.colHeader, styles.colWeight, isDark && styles.textSecondaryDark]}
              >
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

      {/* Info card below (like "Understanding the metrics" on Fitness tab) */}
      <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
        <View style={styles.infoRow}>
          <View style={[styles.infoDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            Muscle groups for each exercise type have been sourced from{' '}
            <Text
              style={styles.infoLink}
              onPress={() => Linking.openURL('https://github.com/yuhonas/free-exercise-db')}
            >
              free-exercise-db
            </Text>
            , an open public domain exercise dataset.
          </Text>
        </View>
        <View style={styles.infoRow}>
          <View style={[styles.infoDot, { backgroundColor: '#FCA67A' }]} />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            {hasGender ? (
              <>
                Body type shown as{' '}
                <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                  {genderLabel}
                </Text>
                , based on your intervals.icu profile.
              </>
            ) : (
              <>
                Body type chosen as{' '}
                <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                  {genderLabel}
                </Text>{' '}
                at random, as your intervals.icu profile has no gender set.
              </>
            )}
          </Text>
        </View>
      </View>
    </>
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
  // Info card (matches fitness tab "Understanding the metrics" pattern)
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  infoCardDark: {
    backgroundColor: darkColors.surface,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  infoDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    marginTop: 4,
    marginRight: spacing.xs,
  },
  infoText: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  infoHighlight: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  infoHighlightDark: {
    color: darkColors.textPrimary,
  },
  infoLink: {
    ...typography.caption,
    color: colors.primary,
  },
});
