import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';

import type { ZoneDistribution } from '@/types';
import { formatDurationHuman } from '@/shared/format/format';

interface ZoneDistributionChartProps {
  /** Zone distribution data */
  data?: ZoneDistribution[];
  /** Type of zones to display */
  type?: 'power' | 'hr';
  /** Title override */
  title?: string;
  /** Time period label */
  periodLabel?: string;
}

export const ZoneDistributionChart = React.memo(function ZoneDistributionChart({
  data,
  type = 'power',
  title,
  periodLabel,
}: ZoneDistributionChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const displayTitle =
    title || (type === 'power' ? t('stats.powerZones') : t('stats.heartRateZones'));
  const displayPeriodLabel = periodLabel || t('stats.last30Days');

  // All hooks must be called before any conditional returns
  // Calculate percentages if data is provided
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const totalSeconds = data.reduce((sum, d) => sum + d.seconds, 0);
    return data.map((d) => ({
      ...d,
      percentage: totalSeconds > 0 ? Math.round((d.seconds / totalSeconds) * 100) : 0,
    }));
  }, [data]);

  const bands = useMemo<ZoneBand[]>(
    () =>
      processedData.map((zone) => ({
        key: zone.zone,
        label: `Z${zone.zone}`,
        colour: zone.color,
        percent: zone.percentage,
        primary: formatDurationHuman(zone.seconds),
        secondary: zone.name,
      })),
    [processedData]
  );

  // Show empty state if no data
  if (!data || data.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{displayTitle}</Text>
          <Text style={[styles.subtitle, isDark && styles.textDark]}>{displayPeriodLabel}</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>{t('stats.noZoneData')}</Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {type === 'power'
              ? t('stats.completeActivitiesPower')
              : t('stats.completeActivitiesHr')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{displayTitle}</Text>
        <Text style={[styles.subtitle, isDark && styles.textDark]}>{displayPeriodLabel}</Text>
      </View>

      <View style={styles.bars}>
        <ZoneHistogram bands={bands} />
      </View>

      {/* Total time */}
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, isDark && styles.textDark]}>{t('stats.totalTime')}</Text>
        <Text style={[styles.totalValue, isDark && styles.textLight]}>
          {formatDurationHuman(processedData.reduce((sum, d) => sum + d.seconds, 0))}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  bars: {
    marginBottom: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
