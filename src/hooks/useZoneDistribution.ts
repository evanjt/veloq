import { useMemo } from 'react';
import type { Activity, ZoneDistribution } from '@/types';
import { DEFAULT_POWER_ZONES, DEFAULT_HR_ZONES, POWER_ZONE_COLORS, HR_ZONE_COLORS } from './useSportSettings';

interface UseZoneDistributionOptions {
  type: 'power' | 'hr';
  activities?: Activity[];
}

/**
 * Aggregates zone time distribution from activities
 * Returns zone distribution data formatted for ZoneDistributionChart
 *
 * Note: API returns different formats for power vs HR zones:
 * - icu_zone_times (power): Array of {id: 'Z1', secs: 123} objects
 * - icu_hr_zone_times (HR): Flat array of seconds [123, 456, ...]
 */
export function useZoneDistribution({
  type,
  activities,
}: UseZoneDistributionOptions): ZoneDistribution[] | undefined {
  return useMemo(() => {
    if (!activities || activities.length === 0) return undefined;

    const defaultZones = type === 'power' ? DEFAULT_POWER_ZONES : DEFAULT_HR_ZONES;
    const zoneColors = type === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

    // Aggregate zone times across all activities
    const aggregatedTimes: number[] = new Array(defaultZones.length).fill(0);
    let hasZoneData = false;

    for (const activity of activities) {
      if (type === 'power') {
        // Power zones: icu_zone_times is array of {id: 'Z1', secs: 123} objects
        const zoneTimes = activity.icu_zone_times;
        if (zoneTimes && zoneTimes.length > 0) {
          hasZoneData = true;
          zoneTimes.forEach((zt) => {
            // Map zone ID (Z1, Z2, etc.) to index
            const match = zt.id.match(/Z(\d+)/);
            if (match) {
              const zoneIdx = parseInt(match[1], 10) - 1;
              if (zoneIdx >= 0 && zoneIdx < aggregatedTimes.length) {
                aggregatedTimes[zoneIdx] += zt.secs || 0;
              }
            }
          });
        }
      } else {
        // HR zones: icu_hr_zone_times is flat array of seconds
        const hrTimes = activity.icu_hr_zone_times;
        if (hrTimes && hrTimes.length > 0) {
          hasZoneData = true;
          hrTimes.forEach((secs, idx) => {
            if (idx < aggregatedTimes.length) {
              aggregatedTimes[idx] += secs || 0;
            }
          });
        }
      }
    }

    // If no activities have zone data, return undefined
    if (!hasZoneData) return undefined;

    // Calculate total time
    const totalSeconds = aggregatedTimes.reduce((sum, t) => sum + (t || 0), 0);
    if (totalSeconds === 0) return undefined;

    // Build zone distribution array
    const distribution: ZoneDistribution[] = defaultZones.map((zone, idx) => ({
      zone: zone.id,
      name: zone.name,
      seconds: aggregatedTimes[idx] || 0,
      percentage: Math.round(((aggregatedTimes[idx] || 0) / totalSeconds) * 100),
      color: zoneColors[idx] || zoneColors[zoneColors.length - 1],
    }));

    return distribution;
  }, [type, activities]);
}

/**
 * Calculate zone distribution from activity streams (for single activity)
 * Uses heartrate/watts streams and zone thresholds
 */
export function calculateZonesFromStreams(
  stream: number[],
  zones: { min: number; max: number }[],
  zoneColors: string[],
  zoneNames: string[]
): ZoneDistribution[] {
  const zoneCounts: number[] = new Array(zones.length).fill(0);

  for (const value of stream) {
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      if (value >= zone.min && value < zone.max) {
        zoneCounts[i]++;
        break;
      }
    }
  }

  const totalPoints = stream.length;
  if (totalPoints === 0) return [];

  return zones.map((_, idx) => ({
    zone: idx + 1,
    name: zoneNames[idx] || `Zone ${idx + 1}`,
    seconds: zoneCounts[idx], // In this case, it's sample count, not seconds
    percentage: Math.round((zoneCounts[idx] / totalPoints) * 100),
    color: zoneColors[idx] || zoneColors[zoneColors.length - 1],
  }));
}
