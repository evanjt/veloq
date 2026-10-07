import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useActivityLabels } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { EngineReadFailure } from '@/shared/ui';
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
import { type BestEffort, type ClimbBest, type ClimbStatus } from '@/features/stats';
import { ClimbingBestRows } from './ClimbingBestRows';
import { ClimbingStatusNote } from './ClimbingStatusNote';

interface SeasonBestsSectionProps {
  efforts: BestEffort[];
  climbing?: ClimbBest[];
  climbingStatus?: ClimbStatus;
  sport: PrimarySport;
  isLoading: boolean;
}

export function SeasonBestsSection({
  efforts,
  climbing = [],
  climbingStatus,
  sport,
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
    <TouchableOpacity
      testID="season-bests-view-all"
      style={[styles.viewAllRow, isDark && styles.viewAllRowDark]}
      onPress={() => router.push('/best-efforts')}
      activeOpacity={0.7}
    >
      <Text style={[styles.viewAllText, { color: sportText }]}>{t('bestEffortsScreen.title')}</Text>
      <MaterialCommunityIcons name="chevron-right" size={18} color={sportColor} />
    </TouchableOpacity>
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
          <View
            key={effort.label}
            style={[
              styles.row,
              isDark && styles.rowDark,
              index < efforts.length - 1 && styles.rowBorder,
              index < efforts.length - 1 && isDark && styles.rowBorderDark,
            ]}
          >
            <Text style={[styles.label, isDark && styles.labelDark]}>{effort.label}</Text>
            <View style={styles.valueColumn}>
              <Text style={[styles.value, { color: sportText }]}>
                {formatEffortValue(effort.value, sport, t('units.watts'), isMetric)}
              </Text>
              {timeStr && sport !== 'Cycling' && (
                <Text style={[styles.time, isDark && styles.timeDark]}>{timeStr}</Text>
              )}
            </View>
            <View style={styles.activityColumn}>
              {activityName && effort.activityId ? (
                <TouchableOpacity
                  onPress={() => router.push(`/activity/${effort.activityId}`)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.activityName, { color: sportText }]} numberOfLines={1}>
                    {activityName} →
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowDark: {},
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorWithOpacity(ink.black, 0.08),
  },
  rowBorderDark: {
    borderBottomColor: colorWithOpacity(ink.white, 0.08),
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 48,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    width: 100,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.body,
    fontWeight: '700',
  },
  time: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  timeDark: {
    color: darkColors.textSecondary,
  },
  activityColumn: {
    flex: 1,
    marginLeft: spacing.md,
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
