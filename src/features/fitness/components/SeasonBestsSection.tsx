import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useActivityLabels } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { EngineReadFailure, pressable, pressRipple } from '@/shared/ui';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatDurationOrNull } from '@/shared/format/format';
import { formatEffortValue } from '../lib/bestEfforts';
import {
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from '@/features/fitness/stores';
import { colors, darkColors, spacing, typography, colorWithOpacity, ink } from '@/theme';
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
  const { labels: activityMap, error: labelsError } = useActivityLabels(effortIds);

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
      <MaterialCommunityIcons name="chevron-right" size={18} color={sportColor} />
    </Pressable>
  );

  if (isLoading) {
    return (
      <View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
        {viewAll}
      </View>
    );
  }

  if (!hasEfforts && !hasClimbing) {
    return (
      <View>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {t('statsScreen.noEffortData')}
          </Text>
        </View>
        {viewAll}
      </View>
    );
  }

  return (
    <View>
      {labelsError != null && (
        <EngineReadFailure error={labelsError} testID="season-bests-labels-failed" />
      )}
      {(hasEfforts ? efforts : []).map((effort, index) => {
        const activityName = effort.activityId
          ? activityMap.get(effort.activityId)?.name
          : undefined;
        const timeStr = formatDurationOrNull(effort.time);

        return (
          <BestEffortRow
            key={effort.label}
            testID={`season-bests-row-${effort.label}`}
            label={effort.label}
            value={formatEffortValue(effort.value, sport, t('units.watts'), isMetric)}
            secondary={sport !== 'Cycling' ? timeStr : null}
            valueColor={sportText}
            isLast={index === efforts.length - 1}
          >
            {activityName && effort.activityId ? (
              <Pressable
                android_ripple={pressRipple}
                accessibilityRole="button"
                accessibilityLabel={activityName}
                onPress={() => tapTo(`/activity/${effort.activityId}`)}
                style={pressable()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.activityName, { color: sportText }]} numberOfLines={1}>
                  {activityName} →
                </Text>
              </Pressable>
            ) : null}
          </BestEffortRow>
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
  emptyContainer: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyTextDark: {
    color: darkColors.textSecondary,
  },
  activityName: {
    ...typography.caption,
    fontWeight: '500',
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
