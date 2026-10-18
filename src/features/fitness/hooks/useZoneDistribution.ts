import { useMemo } from 'react';
import type { ZoneDistribution } from '@/types';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ZONE_NAME_KEYS } from '@/shared/app/zoneNameKeys';
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

/** Name of default zone `zone` (1-based) in the app language, undefined past the seventh. */
export type DefaultZoneName = (type: 'power' | 'hr', zone: number) => string | undefined;

/**
 * One row per total the engine returns, carrying the engine's whole share beside
 * it, named from the athlete's own zone names, then the app-language default for
 * that zone id, then `Z<n>`.
 */
export function buildZoneDistribution(
  totals: number[] | undefined,
  shares: number[] | undefined,
  type: 'power' | 'hr',
  names: string[] = [],
  defaultName: DefaultZoneName
): ZoneDistribution[] | undefined {
  if (!totals || totals.length === 0) return undefined;

  const totalSeconds = totals.reduce((sum, t) => sum + t, 0);
  if (totalSeconds === 0) return undefined;

  return totals.map((seconds, idx) => ({
    zone: idx + 1,
    name: names[idx] || defaultName(type, idx + 1) || `Z${idx + 1}`,
    seconds,
    share: shares?.[idx] ?? 0,
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
    return buildZoneDistribution(read?.seconds, read?.shares, type, read?.names, defaultName);
  }, [type, sport, days, readActivities, t]);
}
