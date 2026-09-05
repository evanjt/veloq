import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';
import { POWER_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { ActivityDetail } from '@/types';
import { ChartErrorBoundary } from '@/shared/ui';
import { formatDurationHuman } from '@/shared/format/format';

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

  const bands: ZoneBand[] = zoneData.map((zone) => ({
    key: zone.id,
    label: String(zone.id),
    colour: zone.color,
    percent: zone.percent,
    primary: zone.formatted,
    secondary: zone.wattRange,
  }));

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
        <ZoneHistogram bands={bands} />
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
});
