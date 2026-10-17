import React from 'react';
import { View, StyleSheet } from 'react-native';
import { openExternal } from '@/shared/app/openExternal';
import { Text } from 'react-native-paper';
import { Trans, useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatDuration } from '@/shared/format/format';
import { strengthTone, colors, darkColors, layout, spacing, stroke, typography } from '@/theme';

import { useExerciseSets } from '../hooks/useExerciseSets';
import { formatBestSet } from '../lib/formatting';
import { formatWeight } from '@/shared/format/weight';
import { ABSENT, absentLabel } from '@/shared/format/absent';
import { DENSE_TEXT_SCALE, denseExtent } from '@/shared/ui/DenseText';
import { RowDivider } from '@/shared/ui/RowGroup';
import type { ExerciseGroup } from 'veloqrs';
import { Button, Card, InlineLink, Shimmer, SkeletonFrame } from '@/shared/ui';
import { navigateTo } from '@/shared/app/navigation';

/** Set rows the placeholder draws, about one exercise's worth. */
const PLACEHOLDER_SET_ROWS = 3;

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
      <View style={styles.frame}>
        <Card variant="raised">
          <SkeletonFrame testID="exercise-table-skeleton">
            <View style={styles.header}>
              <Shimmer
                width="40%"
                height={typography.body.lineHeight}
                borderRadius={layout.borderRadiusXs}
              />
            </View>
            <Shimmer
              width="50%"
              height={typography.bodySmall.lineHeight}
              borderRadius={layout.borderRadiusXs}
              style={styles.exerciseNamePlaceholder}
            />
            {Array.from({ length: PLACEHOLDER_SET_ROWS }, (_, row) => (
              <View key={row} style={styles.setRow}>
                <Shimmer
                  height={typography.tableValue.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                />
              </View>
            ))}
          </SkeletonFrame>
        </Card>
      </View>
    );
  }

  // No sets and no verdict from the engine: the FIT file is still owed, which
  // is not the same as a session logged without sets. Both drew nothing, so a
  // failed download read as an honest empty session with no way to tell.
  if (groups.length === 0 && outcome === 'pending') {
    return (
      <View style={styles.frame}>
        <Card variant="raised" padding="none">
          <View style={styles.loadingContainer}>
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
              {t('strength.setsNotDownloaded')}
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  if (groups.length === 0) return null;

  const hasSex = athleteSex === 'M' || athleteSex === 'F';
  const bodyType = t(athleteSex === 'F' ? 'strength.female' : 'strength.male');

  return (
    <>
      {/* Exercise card */}
      <View style={styles.frame}>
        <Card variant="raised">
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
              {groupIdx > 0 && (
                <View style={styles.dividerGap}>
                  <RowDivider inset="none" />
                </View>
              )}
              <View style={styles.exerciseHeading}>
                <Text style={[styles.exerciseName, isDark && styles.textDark]}>{group.name}</Text>
                <Button
                  label={t('strength.history')}
                  variant="ghost"
                  size="sm"
                  onPress={() => navigateTo(`/exercise/${group.exerciseCategory}`)}
                />
              </View>
              {group.bestSet ? (
                <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
                  {t('strength.bestSet')}: {formatBestSet(group.bestSet, isMetric, t)}
                </Text>
              ) : null}
              {group.restSeconds.length > 0 && (
                <Text style={[styles.subtitle, isDark && styles.textSecondaryDark]}>
                  {t('strength.restBetweenSets')}:{' '}
                  {group.restSeconds.map(formatDuration).join(' · ')}
                </Text>
              )}

              <View style={styles.headerRow}>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[styles.colHeader, styles.colSet, isDark && styles.textSecondaryDark]}
                >
                  {t('strength.setColumn')}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[styles.colHeader, styles.colReps, isDark && styles.textSecondaryDark]}
                >
                  {t('strength.repsColumn')}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[styles.colHeader, styles.colWeight, isDark && styles.textSecondaryDark]}
                >
                  {t('strength.weightColumn')}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[styles.colHeader, styles.colTime, isDark && styles.textSecondaryDark]}
                >
                  {t('strength.timeColumn')}
                </Text>
              </View>

              {group.sets.map((set, setIdx) => {
                const reps = set.repetitions != null ? String(set.repetitions) : ABSENT;
                const weight = set.weightKg != null ? formatWeight(set.weightKg, isMetric) : ABSENT;
                const time = set.durationSecs != null ? formatDuration(set.durationSecs) : ABSENT;
                return (
                  <View
                    key={set.setOrder}
                    style={[
                      styles.setRow,
                      setIdx > 0 && styles.setRowBorder,
                      setIdx > 0 && isDark && styles.setRowBorderDark,
                    ]}
                  >
                    <Text
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      style={[styles.colValue, styles.colSet, isDark && styles.textDark]}
                    >
                      {setIdx + 1}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      style={[styles.colValue, styles.colReps, isDark && styles.textDark]}
                      accessibilityLabel={absentLabel(reps, t)}
                    >
                      {reps}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      style={[styles.colValue, styles.colWeight, isDark && styles.textDark]}
                      accessibilityLabel={absentLabel(weight, t)}
                    >
                      {weight}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      style={[styles.colValue, styles.colTime, isDark && styles.textSecondaryDark]}
                      accessibilityLabel={absentLabel(time, t)}
                    >
                      {time}
                    </Text>
                  </View>
                );
              })}
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
        </Card>
      </View>

      {/* Info card below (like "Understanding the metrics" on Fitness tab) */}
      <View style={styles.infoFrame}>
        <Card variant="flat">
          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: colors.actionPrimary }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Trans
                i18nKey="strength.muscleSource"
                components={{
                  source: (
                    <InlineLink
                      accessibilityLabel={EXERCISE_DATASET.name}
                      onPress={() => {
                        void openExternal(EXERCISE_DATASET.url);
                      }}
                    >
                      {''}
                    </InlineLink>
                  ),
                }}
              />
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: strengthTone.secondary }]} />
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
        </Card>
      </View>
    </>
  );
}

// The dataset the muscle groups come from. Its name is the project's own and
// reads the same in every language.
const EXERCISE_DATASET = {
  name: 'free-exercise-db',
  url: 'https://github.com/yuhonas/free-exercise-db',
} as const;

/** Column widths in ems of a set row's figures: a set number, a rep count, a time such as "1:30". */
const SET_COLUMN_EMS = 2;
const REPS_COLUMN_EMS = 2.75;
const TIME_COLUMN_EMS = 3.3;

const styles = StyleSheet.create({
  exerciseHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  frame: {
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseNamePlaceholder: {
    marginVertical: spacing.xs,
  },
  exerciseName: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
  dividerGap: {
    paddingVertical: spacing.sm,
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
    borderTopWidth: stroke.hairline,
    borderTopColor: colors.border,
  },
  setRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  colHeader: {
    ...typography.label,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  colValue: {
    ...typography.tableValue,
    color: colors.textPrimary,
  },
  colSet: {
    width: denseExtent(typography.tableValue.fontSize, SET_COLUMN_EMS),
    textAlign: 'center',
  },
  colReps: {
    width: denseExtent(typography.tableValue.fontSize, REPS_COLUMN_EMS),
    textAlign: 'center',
  },
  colWeight: {
    flex: 1,
    textAlign: 'right',
    paddingRight: spacing.md,
  },
  colTime: {
    width: denseExtent(typography.tableValue.fontSize, TIME_COLUMN_EMS),
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
    borderTopWidth: stroke.one,
    borderTopColor: colors.border,
  },
  totalsRowDark: {
    borderTopColor: darkColors.border,
  },
  totalsLabel: {
    ...typography.sectionHeader,
    color: colors.textSecondary,
  },
  totalsValues: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  totalsValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  // Info card (matches fitness tab "Understanding the metrics" pattern)
  infoFrame: {
    marginBottom: spacing.md,
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
    fontWeight: typography.captionBold.fontWeight,
    color: colors.textPrimary,
  },
  infoHighlightDark: {
    color: darkColors.textPrimary,
  },
});
