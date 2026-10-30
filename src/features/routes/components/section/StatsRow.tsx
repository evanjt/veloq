/**
 * Stats row shown above/below the section scatter chart.
 *
 * Displays the direction arrow, a localized "forward" / "reverse" label,
 * a traversal count badge, the average, and the direction's best, each in
 * the basis the chart plots on. The engine says whether that best is the direction's record: a
 * record carries a trophy and the gold value, any other best (the best of a
 * range, a lone lap, a tie) reads as "Best" in the muted value style.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { formatAttemptFigure, type AttemptBasis } from '@/features/routes/lib/attemptBasis';
import { directionColour } from '@/features/routes/lib/directionColour';
import { DirectionArrow, directionWord } from './DirectionCue';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { Icon } from '@/shared/ui/Icon';
import { Badge } from '@/shared/ui/Badge';

export interface StatsRowProps {
  direction: 'forward' | 'reverse';
  stats: DirectionSummaryStats | null;
  bestRecord: DirectionBestRecord | null;
  /** True when `bestRecord` is the direction's record, as the engine judges it. */
  bestIsRecord: boolean;
  /** The engine timed the pass holding `bestRecord` by projection to a gate. */
  bestEstimated?: boolean;
  pointCount: number;
  /** What the avg and best read as, the basis the chart plots on. */
  basis: AttemptBasis;
  isDark: boolean;
}

export function StatsRow({
  direction,
  stats,
  bestRecord,
  bestIsRecord,
  bestEstimated = false,
  pointCount,
  basis,
  isDark,
}: StatsRowProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  if (pointCount === 0) return null;
  const color = directionColour(direction, isDark);

  const count = stats?.count ?? pointCount;
  const bestValue = bestRecord
    ? formatAttemptFigure(basis, bestRecord.bestTime, bestRecord.bestPace, isMetric)
    : '';

  return (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statsLeft}>
          <DirectionArrow direction={direction} color={color} />
          <Text style={[styles.statsDirection, isDark && styles.textLight]}>
            {directionWord(t, direction)}
          </Text>
          <Badge
            tone="count"
            text={count}
            label={t('sections.traversalsCount', { count })}
            isDark={isDark}
            style={styles.countBadgePlace}
            testID={`stats-row-count-${direction}`}
          />
        </View>
        <View style={styles.statsMiddle}>
          {stats?.avgTime != null && (
            <Text style={[styles.statsValue, isDark && styles.textSecondary]}>
              {t('sections.avgValue', {
                value: formatAttemptFigure(basis, stats.avgTime, stats.avgSpeed, isMetric),
              })}
            </Text>
          )}
        </View>
        {bestRecord ? (
          <View style={styles.prBadge}>
            {bestIsRecord ? (
              <View testID={`stats-row-trophy-${direction}`}>
                <Icon
                  name="trophy"
                  size={iconSize.xs}
                  color={isDark ? darkColors.achievement : colors.achievement}
                />
              </View>
            ) : null}
            <Text
              testID={`stats-row-best-${direction}`}
              style={
                bestIsRecord
                  ? [styles.prTime, isDark && styles.prTimeDark]
                  : [styles.statsValue, isDark && styles.textSecondary]
              }
            >
              {bestIsRecord ? bestValue : t('sections.bestValue', { value: bestValue })}
            </Text>
            {bestEstimated ? (
              <Text
                testID={`stats-row-best-estimated-${direction}`}
                style={[styles.estimated, isDark && styles.textSecondary]}
              >
                {t('sections.estimated')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {(stats?.outsideBandCount ?? 0) > 0 && (
        <Text
          testID={`stats-row-outside-band-${direction}`}
          style={[styles.outsideBand, isDark && styles.textSecondary]}
        >
          {t('sections.histogramOutsideBand', { attempts: stats?.outsideBandCount })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.sm,
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statsDirection: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  countBadgePlace: {
    marginLeft: spacing.xxs,
  },
  statsMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  statsValue: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  outsideBand: {
    ...typography.micro,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.xs,
    color: colors.textSecondary,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  estimated: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  prTime: {
    ...typography.captionBold,
    color: colors.achievementText,
  },
  prTimeDark: {
    color: darkColors.achievementText,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
