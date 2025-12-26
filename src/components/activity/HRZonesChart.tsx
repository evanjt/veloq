import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme, Text } from 'react-native';
import { colors, darkColors, opacity, typography, spacing } from '@/theme';
import { useHRZones } from '@/providers';
import { useSportSettings, getSettingsForSport, HR_ZONE_COLORS } from '@/hooks';
import type { ActivityStreams, ActivityDetail } from '@/types';

interface HRZonesChartProps {
  streams: ActivityStreams;
  /** Activity type for looking up sport-specific settings */
  activityType?: string;
  /** Activity data with pre-computed zone times */
  activity?: ActivityDetail;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
}

export function HRZonesChart({
  streams,
  activityType = 'Ride',
  activity,
}: HRZonesChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Get HR zones from API (sport settings)
  const { data: sportSettings } = useSportSettings();
  const settings = getSettingsForSport(sportSettings, activityType);

  // Fallback to local stored settings
  const { maxHR: localMaxHR, zones: localZones } = useHRZones();

  // Use API max_hr if available, otherwise local settings
  const maxHR = settings?.max_hr ?? localMaxHR;

  // Build zone data - prefer activity's zones, then sport settings, then local
  // Activity has icu_hr_zones (BPM thresholds) and icu_hr_zone_times (seconds in each zone)
  const { zones, zoneData } = useMemo(() => {
    // Check if activity has pre-computed zone times
    const activityZones = (activity as { icu_hr_zones?: number[] })?.icu_hr_zones;
    const activityZoneTimes = (activity as { icu_hr_zone_times?: number[] })?.icu_hr_zone_times;

    // Determine which zones to use (activity > sport settings > local)
    const apiZones = activityZones ?? (settings?.hr_zones as unknown as number[] | undefined);
    const zoneNames = (settings as { hr_zone_names?: string[] })?.hr_zone_names;

    let builtZones: Array<{
      id: number;
      name: string;
      minBpm: number;
      maxBpm: number;
      min: number;
      max: number;
      color: string;
    }>;

    if (apiZones && apiZones.length > 0 && typeof apiZones[0] === 'number') {
      // API format: array of BPM upper bounds
      builtZones = apiZones.map((upperBpm, idx) => {
        const lowerBpm = idx === 0 ? 0 : apiZones[idx - 1];
        const zoneName = zoneNames?.[idx] || `Zone ${idx + 1}`;
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
      builtZones = localZones.map(zone => ({
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
            formatted: formatDuration(seconds),
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
      formatted: formatDuration(zoneTimes[idx]),
    }));

    return { zones: builtZones, zoneData: computedData };
  }, [streams, maxHR, settings, localZones, activity]);

  // Dynamic sizing based on number of zones
  // For many zones (6+), we use a slightly tighter layout but keep text readable
  const isCompact = zones.length > 5;
  const barHeight = isCompact ? 14 : 16;
  const rowPadding = isCompact ? 2 : 3;

  if (!zoneData) {
    return (
      <View style={styles.placeholder}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          No heart rate data
        </Text>
      </View>
    );
  }

  // Helper to get zone BPM range
  const getZoneBPM = (zone: { minBpm: number; maxBpm: number }) => {
    return `${zone.minBpm}-${zone.maxBpm}`;
  };

  // Data source label
  const dataSource = settings?.max_hr ? 'intervals.icu' : 'local';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, isDark && styles.titleDark]}>Time in HR Zones</Text>
        <Text style={[styles.maxHRLabel, isDark && styles.maxHRLabelDark]}>
          Max: {maxHR} bpm
        </Text>
      </View>
      <View style={styles.zonesContainer}>
        {zoneData.map((zone) => (
          <View key={zone.id} style={[styles.zoneRow, { paddingVertical: rowPadding }]}>
            {/* Zone label */}
            <Text style={[styles.zoneNumber, isCompact && styles.zoneNumberCompact, { color: zone.color }]}>Z{zone.id}</Text>

            {/* Percentage - always shown at start, theme-aware color */}
            <Text style={[styles.zonePercent, isCompact && styles.zonePercentCompact, isDark && styles.zonePercentDark]}>
              {zone.percent > 0.5 ? `${Math.round(zone.percent)}%` : '-'}
            </Text>

            {/* Bar */}
            <View style={[styles.barContainer, { height: barHeight, borderRadius: barHeight / 2 }, isDark && styles.barContainerDark]}>
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

            {/* Time and BPM range */}
            <View style={[styles.zoneStats, isCompact && styles.zoneStatsCompact]}>
              <Text style={[styles.zoneTime, isCompact && styles.zoneTimeCompact, isDark && styles.zoneTimeDark]}>
                {zone.percent > 0.5 ? zone.formatted : '-'}
              </Text>
              <Text style={[styles.zoneBPM, isCompact && styles.zoneBPMCompact, isDark && styles.zoneBPMDark]}>
                {getZoneBPM(zone)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
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
  zonesContainer: {
    // No flex: 1 - let it size based on content
  },
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
  zoneBPM: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  zoneBPMCompact: {
    fontSize: typography.pillLabel.fontSize,
  },
  zoneBPMDark: {
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
