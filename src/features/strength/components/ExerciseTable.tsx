import React from 'react';
import { View, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from 'react-native-paper';
import { Trans, useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatDuration } from '@/shared/format/format';
import { colors, darkColors, spacing, layout, typography, shadows, brand } from '@/theme';

import { useExerciseSets } from '../hooks/useExerciseSets';
import { formatWeight } from '@/shared/format/weight';
import type { ExerciseGroup } from 'veloqrs';
import { Button } from '@/shared/ui';

interface ExerciseTableProps {
  activityId: string;
  activityType: string;
  isDark: boolean;
  athleteSex?: string | undefined;
  exerciseGroups?: ExerciseGroup[] | undefined;
}

export function ExerciseTable({
  activityId,
  activityType,
  isDark,
  athleteSex,
  exerciseGroups,
}: ExerciseTableProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMetric = useMetricSystem();
  const { session, isLoading, outcome } = useExerciseSets(activityId, activityType);

  const groups = session.groups.map((group) => {
    const fromDetail = exerciseGroups?.find(
      (candidate) =>
        candidate.name === group.name &&
        candidate.exerciseCategory === group.exerciseCategory &&
        candidate.sets.length === group.sets.length &&
        candidate.sets.every((set, index) => {
          const current = group.sets[index];
          return (
            set.setOrder === current?.setOrder &&
            set.weightKg === current.weightKg &&
            set.repetitions === current.repetitions &&
            set.durationSecs === current.durationSecs &&
            set.startTime === current.startTime
          );
        })
    );
    return fromDetail ?? group;
  });

  if (isLoading) {
    return (
      <View style={[styles.card, isDark && styles.cardDark, styles.loadingContainer]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  // No sets and no verdict from the engine: the FIT file is still owed, which
  // is not the same as a session logged without sets. Both drew nothing, so a
  // failed download read as an honest empty session with no way to tell.
  if (groups.length === 0 && outcome === 'pending') {
    return (
      <View style={[styles.card, isDark && styles.cardDark, styles.loadingContainer]}>
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
          {t('strength.setsNotDownloaded')}
        </Text>
      </View>
    );
  }

  if (groups.length === 0) return null;

  const hasSex = athleteSex === 'M' || athleteSex === 'F';
  const bodyType = t(athleteSex === 'F' ? 'strength.female' : 'strength.male');

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
              sets: session.activeSetCount,
            })}
          </Text>
        </View>

        {groups.map((group, groupIdx) => (
          <View key={`${group.name}-${groupIdx}`}>
            {groupIdx > 0 && <View style={[styles.divider, isDark && styles.dividerDark]} />}
            <View style={styles.exerciseHeading}>
              <Text style={[styles.exerciseName, isDark && styles.textDark]}>{group.name}</Text>
              <Button
                label={t('strength.history')}
                variant="ghost"
                size="sm"
                onPress={() => router.push(`/exercise/${group.exerciseCategory}`)}
              />
            </View>
            {group.bestSet && (
              <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
                {t('strength.bestSet')}: {formatWeight(group.bestSet.weightKg ?? 0, isMetric)} ·{' '}
                {group.bestSet.repetitions ?? '--'} {t('strength.reps')}
              </Text>
            )}
            {group.restSeconds.length > 0 && (
              <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
                {t('strength.restBetweenSets')}: {group.restSeconds.map(formatDuration).join(' · ')}
              </Text>
            )}

            <View style={styles.headerRow}>
              <Text style={[styles.colHeader, styles.colSet, isDark && styles.textSecondaryDark]}>
                {t('strength.setColumn')}
              </Text>
              <Text style={[styles.colHeader, styles.colReps, isDark && styles.textSecondaryDark]}>
                {t('strength.repsColumn')}
              </Text>
              <Text
                style={[styles.colHeader, styles.colWeight, isDark && styles.textSecondaryDark]}
              >
                {t('strength.weightColumn')}
              </Text>
              <Text style={[styles.colHeader, styles.colTime, isDark && styles.textSecondaryDark]}>
                {t('strength.timeColumn')}
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

        {/* Totals row */}
        <View style={[styles.totalsRow, isDark && styles.totalsRowDark]}>
          <Text style={[styles.totalsLabel, isDark && styles.textSecondaryDark]}>
            {t('strength.totalLabel')}
          </Text>
          <View style={styles.totalsValues}>
            {session.totalVolumeKg > 0 && (
              <Text style={[styles.totalsValue, isDark && styles.textDark]}>
                {formatWeight(Math.round(session.totalVolumeKg), isMetric)}
              </Text>
            )}
            {session.totalDurationSecs > 0 && (
              <Text style={[styles.totalsValue, isDark && styles.textSecondaryDark]}>
                {formatDuration(session.totalDurationSecs)}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Info card below (like "Understanding the metrics" on Fitness tab) */}
      <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
        <View style={styles.infoRow}>
          <View style={[styles.infoDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            <Trans
              i18nKey="strength.muscleSource"
              components={{
                source: (
                  <Text
                    style={[styles.infoLink, isDark && { color: darkColors.linkTeal }]}
                    onPress={() => Linking.openURL('https://github.com/yuhonas/free-exercise-db')}
                  >
                    {''}
                  </Text>
                ),
              }}
            />
          </Text>
        </View>
        <View style={styles.infoRow}>
          <View style={[styles.infoDot, { backgroundColor: brand.tealDark }]} />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            <Trans
              i18nKey={hasSex ? 'strength.bodyTypeFromProfile' : 'strength.bodyTypeDefault'}
              values={{ bodyType }}
              components={{
                type: (
                  <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                    {''}
                  </Text>
                ),
              }}
            />
          </Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  exerciseHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
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
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseName: {
    fontSize: typography.bodySmall.fontSize,
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
    paddingBottom: spacing.xs,
  },
  setRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xsPlus,
  },
  setRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  setRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  colHeader: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colValue: {
    fontSize: typography.bodySmall.fontSize,
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
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  totalsRowDark: {
    borderTopColor: darkColors.border,
  },
  totalsLabel: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalsValues: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  totalsValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
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
    borderRadius: layout.borderRadiusXs,
    marginTop: spacing.xs,
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
    color: colors.linkTeal,
  },
});
