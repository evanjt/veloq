import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useTheme } from '@/hooks';
import { useTodayWorkout } from '@/hooks/home/useTodayWorkout';
import { useActivityPatterns } from '@/hooks/home/useActivityPatterns';
import { useWellness } from '@/hooks/fitness';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS, formatDuration } from '@/lib';
import { colors, darkColors, spacing, layout } from '@/theme';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Compact insight card for the Feed tab that surfaces one headline from Route Intelligence.
 * Tapping navigates to the Routes tab. Shows nothing when there's no relevant content.
 *
 * Priority: planned workout > activity pattern > readiness only.
 */
export const TodayTeaser = React.memo(function TodayTeaser() {
  const { isDark } = useTheme();
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
    headline = `${todayWorkout.name} today`;
    const topSection = todayPattern?.commonSections?.[0];
    if (topSection && topSection.trend === 1) {
      subtitle = `PR opportunity on ${topSection.sectionName}`;
    }
  } else if (todayPattern) {
    const sportLabel = todayPattern.sportType === 'Run' ? 'run' : 'ride';
    const dayName = DAY_NAMES[todayPattern.primaryDay] ?? '';
    headline = `${dayName}s you usually ${sportLabel} ~${formatDuration(todayPattern.avgDurationSecs)}`;
    const topSection = todayPattern.commonSections?.[0];
    if (topSection) {
      const trendLabel =
        topSection.trend === 1 ? 'improving \u2191' : topSection.trend === 0 ? 'stable' : '';
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
