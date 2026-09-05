import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';
import { useHRZones } from '@/features/fitness/stores';
import {
  useSportSettings,
  getSettingsForSport,
  HR_ZONE_COLORS,
} from '@/shared/app/useSportSettings';
import type { ActivityStreams, ActivityDetail } from '@/types';
import { ChartErrorBoundary } from '@/shared/ui';
import { formatDurationHuman } from '@/shared/format/format';
import { resolveMaxHR } from '../lib/hrZones';

interface HRZonesChartProps {
  streams: ActivityStreams;
  /** Activity type for looking up sport-specific settings */
  activityType?: string;
  /** Activity data with pre-computed zone times */
  activity?: ActivityDetail;
}

export function HRZonesChart({ streams, activityType = 'Ride', activity }: HRZonesChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // Get HR zones from API (sport settings)
  const { data: sportSettings } = useSportSettings();
  const settings = getSettingsForSport(sportSettings, activityType);

  // Fallback to local stored settings
  const { maxHR: localMaxHR, zones: localZones } = useHRZones();

  // Use API max_hr if available, otherwise local settings
  const maxHR = resolveMaxHR(settings?.max_hr, localMaxHR);

  // Build zone data - prefer activity's zones, then sport settings, then local
  // Activity has icu_hr_zones (BPM thresholds) and icu_hr_zone_times (seconds in each zone)
  const { zoneData } = useMemo(() => {
    // Check if activity has pre-computed zone times
    const activityZones = (activity as { icu_hr_zones?: number[] })?.icu_hr_zones;
    const activityZoneTimes = (activity as { icu_hr_zone_times?: number[] })?.icu_hr_zone_times;

    // Determine which zones to use (activity > sport settings > local)
    // Note: hr_zones from API may be Zone[] or number[] depending on endpoint
    const apiZones = activityZones ?? (settings?.hr_zones as number[] | undefined);
    // hr_zone_names is an optional field on some sport settings responses
    const zoneNames = (settings as { hr_zone_names?: string[] } | undefined)?.hr_zone_names;

    let builtZones: {
      id: number;
      name: string;
      minBpm: number;
      maxBpm: number;
      min: number;
      max: number;
      color: string;
    }[];

    if (apiZones && apiZones.length > 0 && typeof apiZones[0] === 'number') {
      // API format: array of BPM upper bounds
      builtZones = apiZones.map((upperBpm, idx) => {
        const lowerBpm = idx === 0 ? 0 : apiZones[idx - 1];
        const zoneName = zoneNames?.[idx] || t('activity.zoneDefault', { number: idx + 1 });
        return {
          id: idx + 1,
          name: zoneName,
          minBpm: lowerBpm,
          maxBpm: upperBpm,
          min: lowerBpm / maxHR,
          max: upperBpm / maxHR,
          color: HR_ZONE_COLORS[idx] ?? HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1],
        };
      });
    } else {
      // Local zones are percentage-based
      builtZones = localZones.map((zone) => ({
        ...zone,
        minBpm: Math.round(zone.min * maxHR),
        maxBpm: Math.round(zone.max * maxHR),
      }));
    }

    // If activity has pre-computed zone times, use them directly
    if (activityZoneTimes && activityZoneTimes.length > 0) {
      const totalTime = activityZoneTimes.reduce((sum, t) => sum + t, 0);
      if (totalTime > 0) {
        const computedData = builtZones.map((zone, idx) => {
          const seconds = activityZoneTimes[idx] || 0;
          return {
            ...zone,
            seconds,
            percent: (seconds / totalTime) * 100,
            formatted: formatDurationHuman(seconds),
          };
        });
        return { zones: builtZones, zoneData: computedData };
      }
    }

    // Otherwise calculate from streams
    const { heartrate, time } = streams;
    if (!heartrate || !time || heartrate.length < 2) {
      return { zones: builtZones, zoneData: null };
    }

    const zoneTimes: number[] = builtZones.map(() => 0);
    let totalTime = 0;

    for (let i = 1; i < heartrate.length; i++) {
      const hr = heartrate[i];
      const dt = time[i] - time[i - 1];

      if (dt > 0 && dt < 60 && hr > 0) {
        totalTime += dt;
        const hrPercent = hr / maxHR;

        for (let z = builtZones.length - 1; z >= 0; z--) {
          if (hrPercent >= builtZones[z].min) {
            zoneTimes[z] += dt;
            break;
          }
        }
      }
    }

    if (totalTime === 0) return { zones: builtZones, zoneData: null };

    const computedData = builtZones.map((zone, idx) => ({
      ...zone,
      seconds: zoneTimes[idx],
      percent: (zoneTimes[idx] / totalTime) * 100,
      formatted: formatDurationHuman(zoneTimes[idx]),
    }));

    return { zones: builtZones, zoneData: computedData };
  }, [streams, maxHR, settings, localZones, activity]);

  if (!zoneData) {
    return (
      <View style={styles.placeholder}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          {t('activity.noHeartRateData')}
        </Text>
      </View>
    );
  }

  const bands: ZoneBand[] = zoneData.map((zone) => ({
    key: zone.id,
    label: `Z${zone.id}`,
    colour: zone.color,
    percent: zone.percent,
    primary: zone.formatted,
    secondary: `${zone.minBpm}-${zone.maxBpm}`,
  }));

  return (
    <ChartErrorBoundary height={200} label="Heart Rate Zones">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('activity.timeInHRZones')}
          </Text>
          <Text style={[styles.maxHRLabel, isDark && styles.maxHRLabelDark]}>
            {t('activity.maxHR', { value: maxHR })}
          </Text>
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
  maxHRLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  maxHRLabelDark: {
    color: darkColors.textSecondary,
  },
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
