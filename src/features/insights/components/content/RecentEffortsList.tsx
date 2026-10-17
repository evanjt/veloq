import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { formatDuration, formatShortDate, safeGetTime } from '@/shared/format/format';
import { brand, colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';
import type { SectionPerformanceRecord } from '@/features/routes';
import { pressable, pressRipple } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { directionEfforts, type DirectionBests } from '@/features/insights/lib/directionBests';

const MAX_EFFORTS = 5;

interface RecentEffortsListProps {
  records: SectionPerformanceRecord[];
  bests: DirectionBests;
}

/**
 * Shows the most recent efforts on a section with date, time, and
 * delta from the best of its own direction. An out-and-back shows one row per direction. Tapping navigates to the activity detail page.
 */
export const RecentEffortsList = React.memo(function RecentEffortsList({
  records,
  bests,
}: RecentEffortsListProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Sort by date descending (most recent first) and take up to MAX_EFFORTS
  const recentEfforts = useMemo(() => {
    return directionEfforts(records, bests)
      .sort((a, b) => safeGetTime(b.record.activityDate) - safeGetTime(a.record.activityDate))
      .slice(0, MAX_EFFORTS);
  }, [records, bests]);

  const handlePress = useCallback((activityId: string) => {
    navigateTo(`/activity/${activityId}`);
  }, []);

  if (recentEfforts.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, isDark && styles.headingDark]}>
        {t('insights.data.recentEfforts')}
      </Text>
      {recentEfforts.map(({ record, direction, time, isPr: isPR, delta }) => {
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${formatShortDate(record.activityDate)}, ${formatDuration(time)}`}
            key={`${record.activityId}-${direction}`}
            style={pressable([styles.row, isDark && styles.rowDark])}
            android_ripple={pressRipple}
            onPress={() => handlePress(record.activityId)}
          >
            <View style={styles.rowLeft}>
              <Text style={[styles.date, isDark && styles.dateDark]}>
                {formatShortDate(record.activityDate)}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.time, isDark && styles.timeDark]}>{formatDuration(time)}</Text>
              {isPR ? (
                <View style={styles.prBadge}>
                  <Icon name="trophy" size={iconSize.xs} color={colors.textOnBright} />
                  <Text style={styles.prText}>{t('sections.legendPr')}</Text>
                </View>
              ) : delta != null ? (
                <Text style={[styles.delta, isDark && styles.deltaDark]}>
                  +{formatDuration(delta)}
                </Text>
              ) : null}
              <Icon
                name="chevron-right"
                size={iconSize.sm}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  heading: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  headingDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xsPlus,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.subtle,
  },
  rowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  rowLeft: {
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  date: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  dateDark: {
    color: darkColors.textPrimary,
  },
  time: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  timeDark: {
    color: darkColors.textPrimary,
  },
  delta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  deltaDark: {
    color: darkColors.textSecondary,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: brand.gold,
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusSm,
  },
  prText: {
    ...typography.badge,
    color: colors.textOnBright,
  },
});
