import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';

import type { ZoneDistribution } from '@/types';
import { formatDurationHuman } from '@/shared/format/format';
import { CardHeader } from '@/shared/ui/CardHeader';
import { EmptyState } from '@/shared/ui/EmptyState';

interface ZoneDistributionChartProps {
  /** Zone distribution data */
  data?: ZoneDistribution[] | undefined;
  /** Type of zones to display */
  type?: 'power' | 'hr' | undefined;
  /** Title override */
  title?: string | undefined;
  /** Time period label */
  periodLabel?: string | undefined;
  /**
   * The census answer for the period the caption names. `NotFetched` turns the
   * empty state into "not downloaded", and under bars adds a line saying part
   * of the period is missing. Absent, the card claims nothing either way.
   */
  coverage?: RangeCoverage | undefined;
}

export const ZoneDistributionChart = React.memo(function ZoneDistributionChart({
  data,
  type = 'power',
  title,
  periodLabel,
  coverage,
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
        zone: zone.zone,
        percent: zone.percentage,
        primary: formatDurationHuman(zone.seconds),
        secondary: zone.name,
      })),
    [processedData]
  );

  const notDownloaded = coverage === RangeCoverage.NotFetched;

  // Show empty state if no data
  if (!data || data.length === 0) {
    return (
      <View style={styles.container}>
        <CardHeader
          title={displayTitle}
          accessory={
            <Text style={[styles.subtitle, isDark && styles.textDark]}>{displayPeriodLabel}</Text>
          }
        />
        <View style={styles.emptyState}>
          <EmptyState
            variant="inline"
            title={notDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noZoneData')}
            description={
              notDownloaded
                ? undefined
                : type === 'power'
                  ? t('stats.completeActivitiesPower')
                  : t('stats.completeActivitiesHr')
            }
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <CardHeader
        title={displayTitle}
        accessory={
          <Text style={[styles.subtitle, isDark && styles.textDark]}>{displayPeriodLabel}</Text>
        }
      />

      <View style={styles.bars}>
        <ZoneHistogram bands={bands} />
      </View>

      {/* Total time */}
      <View style={[styles.totalRow, isDark && styles.totalRowDark]}>
        <Text style={[styles.totalLabel, isDark && styles.textDark]}>{t('stats.totalTime')}</Text>
        <Text style={[styles.totalValue, isDark && styles.textLight]}>
          {formatDurationHuman(processedData.reduce((sum, d) => sum + d.seconds, 0))}
        </Text>
      </View>

      {notDownloaded ? (
        <Text
          testID="zone-distribution-partial"
          style={[styles.partial, isDark && styles.textDark]}
        >
          {t('stats.rangePartlyDownloaded')}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
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
  totalRowDark: {
    borderTopColor: darkColors.border,
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
  partial: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
