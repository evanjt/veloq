import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { EmptyState, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatDurationOrNull } from '@/shared/format/format';
import { formatEffortValue } from '../lib/bestEfforts';
import { type PrimarySport } from '@/features/fitness/stores';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  spacing,
  typography,
  stroke,
  opacity,
  themePalette,
} from '@/theme';
import {
  bestEffortsHref,
  type BestEffort,
  type ClimbBest,
  type ClimbStatus,
} from '@/features/stats';
import { BEST_EFFORT_ROW_COUNT, BestEffortRow, BestEffortRowsSkeleton } from './BestEffortRow';
import { ClimbingBestRows } from './ClimbingBestRows';
import { ClimbingStatusNote } from './ClimbingStatusNote';
import { navigateTo } from '@/shared/app/navigation';
import type { Period } from '@/shared/app/period';

interface SeasonBestsSectionProps {
  efforts: BestEffort[];
  climbing?: ClimbBest[];
  climbingStatus?: ClimbStatus;
  sport: PrimarySport;
  /** The range Fitness shows, which the link to Best Efforts opens on. */
  period: Period;
  isLoading: boolean;
}

export function SeasonBestsSection({
  efforts,
  climbing = [],
  climbingStatus,
  sport,
  period,
  isLoading,
}: SeasonBestsSectionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const palette = themePalette(isDark);

  const hasEfforts = efforts.some((e) => e.value !== null);
  const hasClimbingValues = climbing.some((b) => b.vam !== null || b.wattsPerKg !== null);
  const hasClimbingNote =
    !!climbingStatus && (climbingStatus.owed > 0 || climbingStatus.sourceExcluded > 0);
  const hasClimbing = hasClimbingValues || hasClimbingNote;

  const viewAll = (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={t('bestEffortsScreen.viewAll')}
      testID="season-bests-view-all"
      style={[styles.viewAllRow, isDark && styles.viewAllRowDark]}
      onPress={() => navigateTo(bestEffortsHref(period))}
    >
      <Text style={[styles.viewAllText, { color: palette.actionLink }]}>
        {t('bestEffortsScreen.viewAll')}
      </Text>
      <Icon name="chevron-right" size={iconSize.sm} color={palette.actionLink} />
    </PressTarget>
  );

  if (isLoading) {
    return (
      <View>
        <BestEffortRowsSkeleton rows={BEST_EFFORT_ROW_COUNT[sport]} />
        {viewAll}
      </View>
    );
  }

  if (!hasEfforts && !hasClimbing) {
    return (
      <View>
        <EmptyState variant="inline" title={t('statsScreen.noEffortData')} />
        {viewAll}
      </View>
    );
  }

  return (
    <View>
      {(hasEfforts ? efforts : []).map((effort, index) => {
        const timeStr = formatDurationOrNull(effort.time);
        const valueStr = formatEffortValue(effort.value, sport, t('units.watts'), isMetric);
        const showTime = !!timeStr && sport !== 'Cycling';

        return (
          <BestEffortRow
            key={effort.checkpoint}
            testID={`season-bests-row-${effort.checkpoint}`}
            label={effort.label}
            value={valueStr}
            secondary={showTime ? timeStr : null}
            valueColor={palette.textPrimary}
            isLast={index === efforts.length - 1}
            activity={
              effort.activity && effort.activityId
                ? { id: effort.activityId, ...effort.activity }
                : undefined
            }
          />
        );
      })}
      {hasClimbing ? (
        <View>
          <Text style={[styles.climbingTitle, isDark && styles.climbingTitleDark]}>
            {t('bestEffortsScreen.climbingBests')}
          </Text>
          {hasClimbingValues ? <ClimbingBestRows bests={climbing} /> : null}
          <ClimbingStatusNote status={climbingStatus} />
        </View>
      ) : null}
      {viewAll}
    </View>
  );
}

const styles = StyleSheet.create({
  climbingTitle: {
    ...typography.bodySmallBold,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  climbingTitleDark: {
    color: darkColors.textSecondary,
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
    minHeight: layout.minTapTarget,
    marginTop: spacing.xs,
    borderTopWidth: stroke.hairline,
    borderTopColor: colorWithOpacity(ink.black, opacity.tint1),
  },
  viewAllRowDark: {
    borderTopColor: colorWithOpacity(ink.white, opacity.tint1),
  },
  viewAllText: {
    ...typography.captionBold,
    marginRight: spacing.xs,
  },
});
