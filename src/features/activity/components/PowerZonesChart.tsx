import React from 'react';
import { useTranslation } from 'react-i18next';
import { POWER_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { PowerZoneBand } from 'veloqrs';
import { formatPower, formatPowerRange } from '@/shared/format/format';
import { ZoneTimeCard } from './ZoneTimeCard';

interface PowerZonesChartProps {
  /** The bands in watts and the time in each, resolved by the engine from the activity's FTP */
  powerZones: PowerZoneBand[];
  /** The FTP the bands were drawn against */
  ftp?: number | null | undefined;
  movingTime: number;
}

export function PowerZonesChart({ powerZones, ftp, movingTime }: PowerZonesChartProps) {
  const { t } = useTranslation();

  return (
    <ZoneTimeCard
      title={t('activity.timeInPowerZones')}
      headerLabel={ftp ? t('activity.ftp', { value: formatPower(ftp) }) : undefined}
      zoneTotalLabel={(duration) => t('activity.powerZoneTotal', { duration })}
      movingTime={movingTime}
      bands={powerZones.map((band) => ({
        zone: band.zone,
        min: band.minWatts,
        max: band.maxWatts,
        seconds: band.seconds,
        percent: band.percent,
      }))}
      colours={POWER_ZONE_COLORS}
      formatRange={formatPowerRange}
      chartName="Power Zones"
    />
  );
}
