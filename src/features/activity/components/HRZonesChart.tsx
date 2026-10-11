import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography } from '@/theme';
import { HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { HrZoneBand } from 'veloqrs';
import { formatHeartRate } from '@/shared/format/format';
import { DEFAULT_MAX_HR } from '../lib/hrZones';
import { ZoneTimeCard } from './ZoneTimeCard';

interface HRZonesChartProps {
  /** The bands and time in each, resolved by the engine with the live classifier */
  hrZones?: HrZoneBand[] | undefined;
  /** The max HR from the detail screen read, the one the heart rate stat card divides by */
  maxHR?: number | undefined;
  movingTime: number;
}

export function HRZonesChart({ hrZones, maxHR: engineMaxHR, movingTime }: HRZonesChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (!hrZones || hrZones.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          {t('activity.noHeartRateData')}
        </Text>
      </View>
    );
  }

  return (
    <ZoneTimeCard
      title={t('activity.timeInHRZones')}
      headerLabel={t('activity.maxHR', { value: engineMaxHR ?? DEFAULT_MAX_HR })}
      zoneTotalLabel={(duration) => t('activity.hrZoneTotal', { duration })}
      movingTime={movingTime}
      bands={hrZones.map((band) => ({
        zone: band.zone,
        min: band.minBpm,
        max: band.maxBpm,
        seconds: band.seconds,
        percent: band.percent,
      }))}
      colours={HR_ZONE_COLORS}
      formatEdge={formatHeartRate}
      chartName="Heart Rate Zones"
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
