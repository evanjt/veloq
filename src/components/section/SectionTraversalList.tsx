/**
 * Traversal list header (activities title + legend) and the
 * memoized ActivityRow component for the section detail FlatList.
 */

import React, { memo, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { MiniTraceView } from '@/components/routes';
import { CHART_CONFIG } from '@/constants';
import {
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatSpeed,
  formatPace,
  isRunningActivity,
  formatPerformanceDelta,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { Activity, RoutePoint } from '@/types';

const REVERSE_COLOR = colors.reverseDirection;

// -------------------------------------------------------------------
// ActivityRow
// -------------------------------------------------------------------

export interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  direction?: string;
  activityPoints?: RoutePoint[];
  sectionPoints?: RoutePoint[];
  isHighlighted?: boolean;
  sectionDistance?: number;
  lapCount?: number;
  actualSectionTime?: number;
  actualSectionPace?: number;
  isBest?: boolean;
  rank?: number;
  bestTime?: number;
  bestPace?: number;
  isReference?: boolean;
  isExcluded?: boolean;
  onHighlightChange?: (activityId: string | null) => void;
  onSetAsReference?: (activityId: string) => void;
  onInclude?: (activityId: string) => void;
}

export const ActivityRow = memo(function ActivityRow({
  activity,
  isDark,
  direction,
  activityPoints,
  sectionPoints,
  isHighlighted,
  sectionDistance,
  lapCount,
  actualSectionTime,
  actualSectionPace,
  isBest = false,
  rank,
  bestTime,
  bestPace,
  isReference = false,
  isExcluded = false,
  onHighlightChange,
  onSetAsReference,
  onInclude,
}: ActivityRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    router.push(`/activity/${activity.id}`);
  }, [activity.id]);

  const handlePressIn = useCallback(() => {
    onHighlightChange?.(activity.id);
  }, [onHighlightChange, activity.id]);

  const handlePressOut = useCallback(() => {
    onHighlightChange?.(null);
  }, [onHighlightChange]);

  const handleLongPress = useCallback(() => {
    onSetAsReference?.(activity.id);
  }, [onSetAsReference, activity.id]);

  const handleInclude = useCallback(() => {
    onInclude?.(activity.id);
  }, [onInclude, activity.id]);

  const isReverse = direction === 'reverse';
  const traceColor = isHighlighted
    ? colors.chartCyan
    : isReverse
      ? REVERSE_COLOR
      : colors.sameDirection;

  const displayDistance = sectionDistance || activity.distance;
  let sectionTime: number;
  let sectionSpeed: number;

  if (actualSectionTime !== undefined && actualSectionPace !== undefined) {
    sectionTime = Math.round(actualSectionTime);
    sectionSpeed = actualSectionPace;
  } else {
    sectionTime =
      sectionDistance && activity.distance > 0
        ? Math.round(activity.moving_time * (sectionDistance / activity.distance))
        : activity.moving_time;
    sectionSpeed = sectionTime > 0 ? displayDistance / sectionTime : 0;
  }

  const showPace = isRunningActivity(activity.type);
  const showLapCount = lapCount !== undefined && lapCount > 1;

  const { deltaDisplay, deltaColor } = useMemo(() => {
    const timeDelta =
      bestTime !== undefined && sectionTime !== undefined && sectionTime > 0
        ? sectionTime - bestTime
        : undefined;
    const result = formatPerformanceDelta({
      isBest,
      showPace,
      currentSpeed: sectionSpeed,
      bestSpeed: bestPace,
      timeDelta,
    });
    return {
      deltaDisplay: result.deltaDisplay,
      deltaColor: result.deltaDisplay
        ? result.isFaster
          ? colors.success
          : colors.error
        : colors.textSecondary,
    };
  }, [isBest, showPace, sectionSpeed, bestPace, bestTime, sectionTime]);

  return (
    <Pressable
      onPress={isExcluded ? handleInclude : handlePress}
      onPressIn={isExcluded ? undefined : handlePressIn}
      onPressOut={isExcluded ? undefined : handlePressOut}
      onLongPress={isExcluded ? undefined : handleLongPress}
      delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
        isBest && !isExcluded && styles.activityRowBest,
        isReference && !isExcluded && styles.activityRowReference,
        isExcluded && styles.activityRowExcluded,
      ]}
    >
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={sectionPoints}
          primaryColor={traceColor}
          referenceColor={colors.consensusRoute}
          isHighlighted={isHighlighted}
          isDark={isDark}
          width={56}
          height={40}
        />
      ) : (
        <View
          style={[
            styles.activityIcon,
            { backgroundColor: traceColor + '20', width: 56, height: 40 },
          ]}
        >
          <MaterialCommunityIcons
            name={getActivityIcon(activity.type)}
            size={18}
            color={traceColor}
          />
        </View>
      )}
      <View style={styles.activityInfo}>
        <View style={styles.activityNameRow}>
          <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
            {activity.name}
          </Text>
          {isBest && (
            <MaterialCommunityIcons
              name="trophy"
              size={14}
              color={colors.chartGold}
              style={{ marginLeft: 4 }}
            />
          )}
          {isReference && (
            <MaterialCommunityIcons
              name="star"
              size={14}
              color={colors.chartCyan}
              style={{ marginLeft: 4 }}
            />
          )}
          {isReverse && (
            <View style={[styles.directionBadge, { backgroundColor: REVERSE_COLOR + '15' }]}>
              <MaterialCommunityIcons name="swap-horizontal" size={10} color={REVERSE_COLOR} />
            </View>
          )}
          {showLapCount && (
            <View style={[styles.lapBadge, isDark && styles.lapBadgeDark]}>
              <Text style={[styles.lapBadgeText, isDark && styles.lapBadgeTextDark]}>
                {lapCount}x
              </Text>
            </View>
          )}
        </View>
        <View style={styles.activityMetaRow}>
          <Text style={[styles.activityDate, isDark && styles.textMuted]}>
            {formatRelativeDate(activity.start_date_local)}
          </Text>
          {showLapCount && (
            <Text style={[styles.traversalCount, isDark && styles.textMuted]}>
              &middot; {t('sections.traversalsCount', { count: lapCount })}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {showPace ? formatPace(sectionSpeed) : formatSpeed(sectionSpeed)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(sectionTime)}
        </Text>
        {deltaDisplay && !isBest && (
          <Text style={[styles.deltaText, { color: deltaColor }]}>{deltaDisplay}</Text>
        )}
      </View>
      {isExcluded ? (
        <MaterialCommunityIcons name="undo" size={18} color={colors.primary} />
      ) : (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.divider}
        />
      )}
    </Pressable>
  );
});

// -------------------------------------------------------------------
// TraversalListHeader
// -------------------------------------------------------------------

export interface TraversalListHeaderProps {
  isDark: boolean;
  showExcluded?: boolean;
  hasExcluded?: boolean;
  onToggleShowExcluded?: () => void;
}

export function TraversalListHeader({
  isDark,
  showExcluded,
  hasExcluded,
  onToggleShowExcluded,
}: TraversalListHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.activitiesSection}>
      <View style={styles.activitiesHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          {t('sections.activities')}
        </Text>
        <View style={styles.legend}>
          {hasExcluded && onToggleShowExcluded && (
            <TouchableOpacity
              onPress={onToggleShowExcluded}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.legendItem}
            >
              <MaterialCommunityIcons
                name={showExcluded ? 'eye' : 'eye-off'}
                size={14}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </TouchableOpacity>
          )}
          <View style={styles.legendItem}>
            <View style={[styles.legendIndicator, { backgroundColor: colors.chartGold }]} />
            <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('routes.pr')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendIndicator, { backgroundColor: colors.chartCyan }]} />
            <MaterialCommunityIcons name="star" size={12} color={colors.chartCyan} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>
              {t('sections.reference')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// -------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------

const styles = StyleSheet.create({
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  activityRowDark: {
    backgroundColor: darkColors.surface,
  },
  activityRowHighlighted: {
    backgroundColor: 'rgba(0, 188, 212, 0.1)',
  },
  activityRowPressed: {
    opacity: 0.7,
  },
  activityRowBest: {
    borderLeftWidth: 3,
    borderLeftColor: colors.chartGold,
  },
  activityRowExcluded: {
    opacity: 0.4,
  },
  activityRowReference: {
    borderLeftWidth: 3,
    borderLeftColor: colors.chartCyan,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  activityName: {
    fontSize: typography.bodySmall.fontSize + 1,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    gap: 2,
  },
  lapBadge: {
    backgroundColor: colors.primary + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    marginLeft: 4,
  },
  lapBadgeDark: {
    backgroundColor: colors.primary + '25',
  },
  lapBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  lapBadgeTextDark: {
    color: colors.primaryLight,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  traversalCount: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  deltaText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  activityStats: {
    alignItems: 'flex-end',
  },
  activityDistance: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  activitiesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIndicator: {
    width: 3,
    height: 12,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
});
