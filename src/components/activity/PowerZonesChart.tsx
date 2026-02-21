import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, typography, spacing, layout } from '@/theme';
import { POWER_ZONE_COLORS } from '@/hooks';
import type { ActivityDetail } from '@/types';
import { ChartErrorBoundary } from '@/components/ui';
import { formatDurationHuman } from '@/lib/utils/format';

interface PowerZonesChartProps {
  activity: ActivityDetail;
}

export function PowerZonesChart({ activity }: PowerZonesChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const zoneData = useMemo(() => {
    const zoneTimes = activity.icu_zone_times;
    if (!zoneTimes || zoneTimes.length === 0) return null;

    const powerZones = activity.icu_power_zones;
    const totalTime = zoneTimes.reduce((sum, z) => sum + z.secs, 0);
    if (totalTime === 0) return null;

    return zoneTimes.map((zone, idx) => {
      const lowerWatts = idx === 0 ? 0 : (powerZones?.[idx - 1] ?? 0);
      const upperWatts = powerZones?.[idx] ?? null;
      const wattRange = upperWatts ? `${lowerWatts}-${upperWatts}W` : `${lowerWatts}W+`;

      return {
        id: zone.id,
        index: idx,
        seconds: zone.secs,
        percent: (zone.secs / totalTime) * 100,
        formatted: formatDurationHuman(zone.secs),
        color: POWER_ZONE_COLORS[idx] ?? POWER_ZONE_COLORS[POWER_ZONE_COLORS.length - 1],
        wattRange,
      };
    });
  }, [activity.icu_zone_times, activity.icu_power_zones]);

  if (!zoneData) return null;

  const isCompact = zoneData.length > 5;
  const barHeight = isCompact ? 14 : 16;
  const rowPadding = isCompact ? 2 : 3;

  return (
    <ChartErrorBoundary height={200} label="Power Zones">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('activity.timeInPowerZones')}
          </Text>
          {activity.icu_ftp && (
            <Text style={[styles.ftpLabel, isDark && styles.ftpLabelDark]}>
              {t('activity.ftp', { value: activity.icu_ftp })}
            </Text>
          )}
        </View>
        <View style={styles.zonesContainer}>
          {zoneData.map((zone) => (
            <View key={zone.id} style={[styles.zoneRow, { paddingVertical: rowPadding }]}>
              <Text
                style={[
                  styles.zoneNumber,
                  isCompact && styles.zoneNumberCompact,
                  { color: zone.color },
                ]}
              >
                {zone.id}
              </Text>

              <Text
                style={[
                  styles.zonePercent,
                  isCompact && styles.zonePercentCompact,
                  isDark && styles.zonePercentDark,
                ]}
              >
                {zone.percent > 0.5 ? `${Math.round(zone.percent)}%` : '-'}
              </Text>

              <View
                style={[
                  styles.barContainer,
                  { height: barHeight, borderRadius: barHeight / 2 },
                  isDark && styles.barContainerDark,
                ]}
              >
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${Math.min(zone.percent, 100)}%`,
                      backgroundColor: zone.color,
                      borderRadius: barHeight / 2,
                    },
                  ]}
                />
              </View>

              <View style={[styles.zoneStats, isCompact && styles.zoneStatsCompact]}>
                <Text
                  style={[
                    styles.zoneTime,
                    isCompact && styles.zoneTimeCompact,
                    isDark && styles.zoneTimeDark,
                  ]}
                >
                  {zone.percent > 0.5 ? zone.formatted : '-'}
                </Text>
                <Text
                  style={[
                    styles.zoneWatts,
                    isCompact && styles.zoneWattsCompact,
                    isDark && styles.zoneWattsDark,
                  ]}
                >
                  {zone.wattRange}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ChartErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: colors.textOnDark,
  },
  ftpLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  ftpLabelDark: {
    color: darkColors.textSecondary,
  },
  zonesContainer: {},
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  zoneNumber: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    width: 24,
  },
  zoneNumberCompact: {
    fontSize: typography.label.fontSize,
    width: 22,
  },
  zonePercent: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    width: 32,
    textAlign: 'right',
    color: colors.textPrimary,
    marginRight: 6,
  },
  zonePercentCompact: {
    fontSize: typography.micro.fontSize,
    width: 28,
    marginRight: spacing.xs,
  },
  zonePercentDark: {
    color: colors.textOnDark,
  },
  barContainer: {
    flex: 1,
    height: 16,
    backgroundColor: opacity.overlay.medium,
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
  },
  barContainerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  bar: {
    height: '100%',
    borderRadius: layout.borderRadiusSm,
  },
  zoneStats: {
    width: 75,
    marginLeft: 6,
    alignItems: 'flex-end',
  },
  zoneStatsCompact: {
    width: 65,
    marginLeft: spacing.xs,
  },
  zoneTime: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  zoneTimeCompact: {
    fontSize: typography.micro.fontSize,
  },
  zoneTimeDark: {
    color: colors.textOnDark,
  },
  zoneWatts: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  zoneWattsCompact: {
    fontSize: typography.pillLabel.fontSize,
  },
  zoneWattsDark: {
    color: darkColors.textSecondary,
  },
});
