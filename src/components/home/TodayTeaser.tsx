import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useTodayWorkout } from '@/hooks/home/useTodayWorkout';
import { useActivityPatterns } from '@/hooks/home/useActivityPatterns';
import { useWellness } from '@/hooks/fitness';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, formatDurationHuman } from '@/lib';
import { getSportDisplayName } from '@/hooks/insights/sectionClusterInsights';
import { colors, darkColors, spacing, layout } from '@/theme';

/** Get locale-aware plural day name (e.g. "Mondays") using Intl API */
function getPluralDayName(dayIndex: number, locale: string): string {
  // dayIndex: 0=Mon, 1=Tue, ..., 6=Sun (ISO week)
  // Date(2024-01-01) is a Monday
  const date = new Date(2024, 0, 1 + dayIndex);
  const name = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Compact insight card for the Feed tab that surfaces one headline from Route Intelligence.
 * Tapping navigates to the Routes tab. Shows nothing when there's no relevant content.
 *
 * Priority: planned workout > activity pattern > readiness only.
 */
export const TodayTeaser = React.memo(function TodayTeaser() {
  const { isDark } = useTheme();
  const { t, i18n } = useTranslation();
  const { todayWorkout } = useTodayWorkout();
  const { todayPattern } = useActivityPatterns();

  // Readiness
  const { data: wellnessData } = useWellness('1m');
  const latestWellness = wellnessData
    ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id))[0]
    : null;
  const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
  const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
  const tsb = ctl - atl;
  const formZone = getFormZone(tsb);
  const formColor = FORM_ZONE_COLORS[formZone];
  const formLabel = FORM_ZONE_LABELS[formZone];

  // Build headline
  let headline: string | null = null;
  let subtitle: string | null = null;

  if (todayWorkout) {
    headline = t('insights.teaser.workoutToday', { name: todayWorkout.name });
    const topSection = todayPattern?.commonSections?.[0];
    if (topSection && topSection.trend === 1) {
      subtitle = t('insights.teaser.prOpportunity', { name: topSection.sectionName });
    }
  } else if (todayPattern) {
    const sportLabel = getSportDisplayName(todayPattern.sportType);
    const dayName = getPluralDayName(todayPattern.primaryDay, i18n.language);
    const duration = formatDurationHuman(todayPattern.avgDurationSecs);
    headline = t('insights.teaser.usualPattern', { day: dayName, sport: sportLabel, duration });
    const topSection = todayPattern.commonSections?.[0];
    if (topSection) {
      const trendLabel =
        topSection.trend === 1
          ? t('insights.teaser.improving')
          : topSection.trend === 0
            ? t('insights.teaser.stable')
            : '';
      if (trendLabel) {
        subtitle = `${topSection.sectionName} ${trendLabel}`;
      }
    }
  }

  // Show nothing if we have no content at all
  if (!headline && !latestWellness) return null;

  return (
    <TouchableOpacity
      style={[styles.container, isDark && styles.containerDark]}
      onPress={() => router.push('/(tabs)/routes')}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <View style={[styles.formDot, { backgroundColor: formColor }]} />
        <Text style={[styles.formLabel, { color: formColor }]}>{formLabel}</Text>
        {headline && (
          <Text style={[styles.headline, isDark && styles.textLight]} numberOfLines={1}>
            {' \u00B7 '}
            {headline}
          </Text>
        )}
      </View>
      {subtitle && (
        <Text style={[styles.subtitle, isDark && styles.textMuted]} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: '#F8F8F8',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  headline: {
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginLeft: 12, // align with text after dot
  },
});
