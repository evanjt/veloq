import { useMemo } from 'react';
import type { ZoneDistribution } from '@/types';
import { useTranslation } from 'react-i18next';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import { type PrimarySport } from '@/features/fitness/stores';
import { trailingDaysWindow } from '@/features/fitness/lib/weekWindow';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

interface UseZoneDistributionOptions {
  type: 'power' | 'hr';
  /** Optional sport filter - if provided, only activities matching this sport are included */
  sport?: PrimarySport;
  /** The trailing range, in days, the totals cover. */
  days: number;
}

// Map PrimarySport to API sport type for engine query
const SPORT_TO_ENGINE_TYPE: Record<PrimarySport, string> = {
  Cycling: 'Ride',
  Running: 'Run',
  Swimming: 'Swim',
};

const DEFAULT_ZONE_NAME_KEYS = {
  power: [
    'zoneNames.power1',
    'zoneNames.power2',
    'zoneNames.power3',
    'zoneNames.power4',
    'zoneNames.power5',
    'zoneNames.power6',
    'zoneNames.power7',
  ],
  hr: [
    'zoneNames.hr1',
    'zoneNames.hr2',
    'zoneNames.hr3',
    'zoneNames.hr4',
    'zoneNames.hr5',
    'zoneNames.hr6',
    'zoneNames.hr7',
  ],
} as const;

/** Name of default zone `zone` (1-based) in the app language, undefined past the seventh. */
export type DefaultZoneName = (type: 'power' | 'hr', zone: number) => string | undefined;

/**
 * One row per total the engine returns, named from the athlete's own zone
 * names, then the app-language default for that zone id, then `Z<n>`.
 */
export function buildZoneDistribution(
  totals: number[] | undefined,
  type: 'power' | 'hr',
  names: string[] = [],
  defaultName: DefaultZoneName
): ZoneDistribution[] | undefined {
  if (!totals || totals.length === 0) return undefined;

  const totalSeconds = totals.reduce((sum, t) => sum + t, 0);
  if (totalSeconds === 0) return undefined;

  const zoneColors = type === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

  return totals.map((seconds, idx) => ({
    zone: idx + 1,
    name: names[idx] || defaultName(type, idx + 1) || `Z${idx + 1}`,
    seconds,
    percentage: Math.round((seconds / totalSeconds) * 100),
    color: zoneColors[Math.min(idx, zoneColors.length - 1)],
  }));
}

/**
 * Aggregates zone time over the trailing `days` from activities via Rust engine SQL aggregate.
 */
export function useZoneDistribution({
  type,
  sport,
  days,
}: UseZoneDistributionOptions): ZoneDistribution[] | undefined {
  const { t } = useTranslation();
  const readActivities = useEngineRead(['activities']);

  return useMemo(() => {
    if (!sport) return undefined;

    const sportType = SPORT_TO_ENGINE_TYPE[sport];
    if (!sportType) return undefined;

    const { startTs, endTs } = trailingDaysWindow(days, new Date());
    const read = readActivities((engine) =>
      engine.getZoneDistribution(sportType, type, startTs, endTs)
    );
    const defaultName: DefaultZoneName = (zoneType, zone) => {
      const key = DEFAULT_ZONE_NAME_KEYS[zoneType][zone - 1];
      return key ? t(key) : undefined;
    };
    return buildZoneDistribution(read?.seconds, type, read?.names, defaultName);
  }, [type, sport, days, readActivities, t]);
}
