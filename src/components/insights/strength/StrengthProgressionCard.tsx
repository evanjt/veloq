import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { formatSetCount, formatWeightRounded as formatWeight } from '@/lib/strength/formatting';
import { colors, darkColors, spacing, opacity, layout, brand } from '@/theme';
import type { ExerciseSummary, MuscleVolume, StrengthProgression } from '@/types';

interface StrengthProgressionCardProps {
  selectedVolume: MuscleVolume;
  progression: StrengthProgression;
  maxProgressWeightedSets: number;
  exerciseSummary?: { exercises: ExerciseSummary[] } | null;
  /** Period label for the right-side stats (e.g. "4 weeks", "7 days"). */
  periodLabel?: string;
  /** Optional children rendered inside the same card after the meta row
   *  (e.g. an embedded exercise list). */
  children?: React.ReactNode;
}

const MINI_BAR_HEIGHT = 26;
const MINI_BAR_WIDTH = 6;

export const StrengthProgressionCard = React.memo(function StrengthProgressionCard({
  selectedVolume,
  progression,
  maxProgressWeightedSets,
  exerciseSummary,
  periodLabel,
  children,
}: StrengthProgressionCardProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const muscleName = MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug;

  return (
    <View style={[styles.progressCard, isDark && styles.progressCardDark]}>
      <View style={styles.titleRow}>
        <View style={styles.titleColumn}>
          <Text style={[styles.progressTitle, isDark && styles.progressTitleDark]}>
            {t('strength.progression', { muscle: muscleName })}
          </Text>
          <Text style={[styles.progressSubtitle, isDark && styles.progressSubtitleDark]}>
            {t('strength.last4Weeks')}
          </Text>
        </View>

        {/* Inline mini bar chart: always represents the trailing 4 weeks
            regardless of the period selector above. */}
        <View style={styles.miniBars}>
          {progression.points.map((point, index) => {
            const isCurrent = index === progression.points.length - 1;
            return (
              <View
                key={point.label}
                style={[
                  styles.miniBar,
                  {
                    height: Math.max(
                      3,
                      (point.weightedSets / maxProgressWeightedSets) * MINI_BAR_HEIGHT
                    ),
                    backgroundColor: isCurrent ? brand.orange : '#FB8C4E',
                  },
                ]}
              />
            );
          })}
        </View>

        {progression.changePct != null && (
          <View
            style={[
              styles.trendBadge,
              progression.trend === 'up'
                ? styles.trendBadgeUp
                : progression.trend === 'down'
                  ? styles.trendBadgeDown
                  : styles.trendBadgeFlat,
            ]}
          >
            <Text
              style={[
                styles.trendText,
                progression.trend === 'up'
                  ? styles.trendTextUp
                  : progression.trend === 'down'
                    ? styles.trendTextDown
                    : styles.trendTextFlat,
              ]}
            >
              {`${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}%`}
            </Text>
          </View>
        )}
      </View>

      {/* Period-driven stats row. The bars above are always 4 weeks; this row
          changes with the period selector (7d / 4w / 3m / 6m). */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, isDark && styles.statValueDark]}>
            {formatSetCount(selectedVolume.weightedSets)}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
            {t('strength.sets')}
          </Text>
        </View>
        {selectedVolume.totalReps > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, isDark && styles.statValueDark]}>
              {selectedVolume.totalReps}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
              {t('strength.reps')}
            </Text>
          </View>
        )}
        {selectedVolume.totalWeightKg > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, isDark && styles.statValueDark]}>
              {formatWeight(selectedVolume.totalWeightKg, isMetric)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
              {t('strength.totalVolume')}
            </Text>
          </View>
        )}
        {exerciseSummary && exerciseSummary.exercises.length > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, isDark && styles.statValueDark]}>
              {exerciseSummary.exercises.length}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
              {exerciseSummary.exercises.length === 1
                ? t('strength.exercise')
                : t('strength.exercises')}
            </Text>
          </View>
        )}
        {periodLabel ? (
          <Text style={[styles.periodHint, isDark && styles.periodHintDark]}>
            {`(${periodLabel})`}
          </Text>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <View style={[styles.metaBox, isDark && styles.metaBoxDark]}>
          <Text style={[styles.metaValue, isDark && styles.metaValueDark]}>
            {formatSetCount(progression.recentAverage)}
          </Text>
          <Text style={[styles.metaLabel, isDark && styles.metaLabelDark]}>
            {t('strength.recentAvg')}
          </Text>
        </View>
        <View style={[styles.metaBox, isDark && styles.metaBoxDark]}>
          <Text style={[styles.metaValue, isDark && styles.metaValueDark]}>
            {formatSetCount(progression.baselineAverage)}
          </Text>
          <Text style={[styles.metaLabel, isDark && styles.metaLabelDark]}>
            {t('strength.earlierAvg')}
          </Text>
        </View>
        <View style={[styles.metaBox, isDark && styles.metaBoxDark]}>
          <Text style={[styles.metaValue, isDark && styles.metaValueDark]}>
            {formatSetCount(progression.peakWeightedSets)}
          </Text>
          <Text style={[styles.metaLabel, isDark && styles.metaLabelDark]}>
            {t('strength.peakWeek')}
          </Text>
        </View>
      </View>

      {children ? <View style={styles.childrenSlot}>{children}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  progressCardDark: {
    backgroundColor: darkColors.surface,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleColumn: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressTitleDark: {
    color: darkColors.textPrimary,
  },
  progressSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  progressSubtitleDark: {
    color: darkColors.textSecondary,
  },
  miniBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: MINI_BAR_HEIGHT,
    gap: 3,
  },
  miniBar: {
    width: MINI_BAR_WIDTH,
    borderRadius: 2,
  },
  trendBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  trendBadgeUp: {
    backgroundColor: '#22C55E26',
  },
  trendBadgeDown: {
    backgroundColor: '#F59E0B26',
  },
  trendBadgeFlat: {
    backgroundColor: '#64748B26',
  },
  trendText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  trendTextUp: {
    color: '#15803D',
  },
  trendTextDown: {
    color: '#B45309',
  },
  trendTextFlat: {
    color: '#475569',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueDark: {
    color: darkColors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  statLabelDark: {
    color: darkColors.textSecondary,
  },
  periodHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 'auto',
  },
  periodHintDark: {
    color: darkColors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  metaBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metaValueDark: {
    color: darkColors.textPrimary,
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  metaLabelDark: {
    color: darkColors.textSecondary,
  },
  childrenSlot: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
