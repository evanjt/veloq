import { useMemo } from 'react';

import { type PrimarySport } from '@/features/fitness/stores';
import type { ZoneDistribution } from '@/types';
import type { FtpTrendView } from '../lib/ftpTrendView';
import { trendOfMetric, type TrendDirection } from '@/shared/format/trend';

interface UseFitnessComputationsArgs {
  sportMode: PrimarySport;
  powerZones: ZoneDistribution[] | undefined;
  hrZones: ZoneDistribution[] | undefined;
  eftpTrend: FtpTrendView | undefined;
}

interface FitnessComputations {
  ftpTrend: TrendDirection | null;
  dominantZone: { name: string; share: number } | null;
}

/**
 * Produces the memoized derivations rendered by FitnessScreen.
 *
 * Pure derivations (no side effects, no fetching) over the raw data the screen
 * has already gathered. The day's loads, form and ramp are the Fitness &
 * Fatigue chart's own readout.
 */
export function useFitnessComputations({
  sportMode,
  powerZones,
  hrZones,
  eftpTrend,
}: UseFitnessComputationsArgs): FitnessComputations {
  // The direction of the engine's step over the card's window
  const ftpTrend = useMemo<FitnessComputations['ftpTrend']>(() => {
    if (!eftpTrend || eftpTrend.previous === undefined) return null;
    return trendOfMetric('ftp', eftpTrend.latest, eftpTrend.previous);
  }, [eftpTrend]);

  // Compute dominant zone for header display
  const dominantZone = useMemo(() => {
    const zones = sportMode === 'Cycling' ? powerZones : hrZones;
    if (!zones || zones.length === 0) return null;
    const sorted = [...zones].sort((a, b) => b.seconds - a.seconds);
    const top = sorted[0];
    if (top.share === 0) return null;
    return { name: top.name, share: top.share };
  }, [sportMode, powerZones, hrZones]);

  return { ftpTrend, dominantZone };
}
