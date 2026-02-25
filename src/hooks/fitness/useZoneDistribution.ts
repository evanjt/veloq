import { useMemo } from 'react';
import type { ZoneDistribution } from '@/types';
import {
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
} from '../useSportSettings';
import { type PrimarySport } from '@/providers';
import { getRouteEngine } from '@/lib/native/routeEngine';

interface UseZoneDistributionOptions {
  type: 'power' | 'hr';
  /** Optional sport filter - if provided, only activities matching this sport are included */
  sport?: PrimarySport;
}

// Map PrimarySport to API sport type for engine query
const SPORT_TO_ENGINE_TYPE: Record<PrimarySport, string> = {
  Cycling: 'Ride',
  Running: 'Run',
  Swimming: 'Swim',
};

/**
 * Aggregates zone time distribution from activities via Rust engine SQL aggregate.
 */
export function useZoneDistribution({
  type,
  sport,
}: UseZoneDistributionOptions): ZoneDistribution[] | undefined {
  return useMemo(() => {
    const defaultZones = type === 'power' ? DEFAULT_POWER_ZONES : DEFAULT_HR_ZONES;
    const zoneColors = type === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

    const engine = getRouteEngine();
    if (!engine || !sport) return undefined;

    const sportType = SPORT_TO_ENGINE_TYPE[sport];
    if (!sportType) return undefined;

    const totals = engine.getZoneDistribution(sportType, type);
    if (totals.length === 0) return undefined;

    const totalSeconds = totals.reduce((sum, t) => sum + t, 0);
    if (totalSeconds === 0) return undefined;

    return defaultZones.map((zone, idx) => ({
      zone: zone.id,
      name: zone.name,
      seconds: totals[idx] || 0,
      percentage: Math.round(((totals[idx] || 0) / totalSeconds) * 100),
      color: zoneColors[idx] || zoneColors[zoneColors.length - 1],
    }));
  }, [type, sport]);
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
