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
 */
export function useZoneDistribution({
  type,
  activities,
}: UseZoneDistributionOptions): ZoneDistribution[] | undefined {
  return useMemo(() => {
    if (!activities || activities.length === 0) return undefined;

    // Get zone times array based on type
    const zoneTimes = type === 'power' ? 'power_zone_times' : 'hr_zone_times';
    const defaultZones = type === 'power' ? DEFAULT_POWER_ZONES : DEFAULT_HR_ZONES;
    const zoneColors = type === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

    // Aggregate zone times across all activities
    const aggregatedTimes: number[] = [];
    let hasZoneData = false;

    for (const activity of activities) {
      const times = activity[zoneTimes];
      if (times && times.length > 0) {
        hasZoneData = true;
        times.forEach((seconds, idx) => {
          aggregatedTimes[idx] = (aggregatedTimes[idx] || 0) + seconds;
        });
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
