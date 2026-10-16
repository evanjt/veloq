import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useActivityLabels } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { EmptyState, ErrorState, pressable, pressRipple, Spinner } from '@/shared/ui';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatDurationOrNull } from '@/shared/format/format';
import { formatEffortValue } from '../lib/bestEfforts';
import {
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from '@/features/fitness/stores';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  spacing,
  typography,
} from '@/theme';
import {
  bestEffortsHref,
  type BestEffort,
  type ClimbBest,
  type ClimbStatus,
} from '@/features/stats';
import { BestEffortRow } from './BestEffortRow';
import { ClimbingBestRows } from './ClimbingBestRows';
import { ClimbingStatusNote } from './ClimbingStatusNote';
import { tapTo } from '@/shared/app/navigation';
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
  const sportColor = SPORT_COLORS[sport];
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK[sport] : SPORT_TEXT_COLORS[sport];

  const effortIds = useMemo(
    () => efforts.map((effort) => effort.activityId).filter((id): id is string => !!id),
    [efforts]
  );
  const {
    labels: activityMap,
    error: labelsError,
    refetch: refetchLabels,
  } = useActivityLabels(effortIds);

  const hasEfforts = efforts.some((e) => e.value !== null);
  const hasClimbingValues = climbing.some((b) => b.vam !== null || b.wattsPerKg !== null);
  const hasClimbingNote =
    !!climbingStatus && (climbingStatus.owed > 0 || climbingStatus.sourceExcluded > 0);
  const hasClimbing = hasClimbingValues || hasClimbingNote;

  const viewAll = (
    <Pressable
      android_ripple={pressRipple}
      accessibilityRole="button"
      accessibilityLabel={t('bestEffortsScreen.title')}
      testID="season-bests-view-all"
      style={pressable([styles.viewAllRow, isDark && styles.viewAllRowDark])}
      onPress={() => tapTo(bestEffortsHref(period))}
    >
      <Text style={[styles.viewAllText, { color: sportText }]}>{t('bestEffortsScreen.title')}</Text>
      <MaterialCommunityIcons name="chevron-right" size={iconSize.sm} color={sportColor} />
    </Pressable>
  );

  if (isLoading) {
    return (
      <View>
        <View style={styles.loadingContainer}>
          <Spinner />
        </View>
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
      {labelsError != null && (
        <ErrorState
          variant="inline"
          error={labelsError}
          onRetry={refetchLabels}
          testID="season-bests-labels-failed"
        />
      )}
      {(hasEfforts ? efforts : []).map((effort, index) => {
        const info = effort.activityId ? activityMap.get(effort.activityId) : undefined;
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
            valueColor={sportText}
            isLast={index === efforts.length - 1}
            activity={info && effort.activityId ? { id: effort.activityId, ...info } : undefined}
          />
        );
      })}
      {hasClimbing ? (
        <View>
          <Text style={[styles.climbingTitle, isDark && styles.climbingTitleDark]}>
            {t('bestEffortsScreen.climbingBests')}
          </Text>
          {hasClimbingValues ? <ClimbingBestRows bests={climbing} sport={sport} /> : null}
          <ClimbingStatusNote status={climbingStatus} />
        </View>
      ) : null}
      {viewAll}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  climbingTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colorWithOpacity(ink.black, 0.08),
  },
  viewAllRowDark: {
    borderTopColor: colorWithOpacity(ink.white, 0.08),
  },
  viewAllText: {
    ...typography.caption,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
});
