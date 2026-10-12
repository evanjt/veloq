import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import { MaxHrSource, type HrZoneBand } from 'veloqrs';
import { EmptyState } from '@/shared/ui';
import { formatHeartRateRange } from '@/shared/format/format';
import { ZoneTimeCard } from './ZoneTimeCard';

interface HRZonesChartProps {
  /** The bands and time in each, resolved by the engine with the live classifier */
  hrZones?: HrZoneBand[] | undefined;
  /** The max HR from the detail screen read, the one the heart rate stat card divides by */
  maxHR?: number | undefined;
  /** Where `maxHR` came from, from the same read */
  maxHrSource?: MaxHrSource | undefined;
  movingTime: number;
}

export function HRZonesChart({ hrZones, maxHR, maxHrSource, movingTime }: HRZonesChartProps) {
  const { t } = useTranslation();

  if (!hrZones || hrZones.length === 0) {
    return (
      <View style={styles.placeholder}>
        <EmptyState variant="inline" title={t('activity.noHeartRateData')} />
      </View>
    );
  }

  let headerLabel: string | undefined;
  let notes: string[] | undefined;
  if (maxHR !== undefined && maxHrSource === MaxHrSource.ActivityZones) {
    headerLabel = t('activity.zoneMaxFromActivity', { value: maxHR });
  } else if (maxHR !== undefined && maxHrSource === MaxHrSource.SportSettings) {
    headerLabel = t('activity.zoneMaxFromSettings', { value: maxHR });
  } else if (maxHR !== undefined && maxHrSource === MaxHrSource.Default) {
    notes = [t('activity.zoneMaxDefault', { value: maxHR }), t('activity.zoneMaxDefaultHint')];
  }

  return (
    <ZoneTimeCard
      title={t('activity.timeInHRZones')}
      headerLabel={headerLabel}
      notes={notes}
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
      formatRange={formatHeartRateRange}
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
});
