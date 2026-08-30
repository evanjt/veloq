import { useMemo } from 'react';
import type { ZoneDistribution } from '@/types';
import {
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
} from '@/shared/app/useSportSettings';
import { type PrimarySport } from '@/features/fitness/stores';
import { getRouteEngine } from '@/shared/native/routeEngine';

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
