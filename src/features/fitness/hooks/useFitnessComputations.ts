import { useMemo } from 'react';

import { type PrimarySport } from '@/features/fitness/stores';
import type { WellnessData, ZoneDistribution } from '@/types';
import type { FtpTrendView } from '../lib/ftpTrendView';
import { getFormZone, type FormZone } from '../lib';
import { trendOfMetric, type TrendDirection } from '@/shared/format/trend';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formFromLoads } from '@/shared/math';

interface FitnessChartValues {
  fitness: number;
  fatigue: number;
  form: number;
}

interface UseFitnessComputationsArgs {
  wellness: WellnessData[] | undefined;
  sportMode: PrimarySport;
  powerZones: ZoneDistribution[] | undefined;
  hrZones: ZoneDistribution[] | undefined;
  eftpTrend: FtpTrendView | undefined;
  selectedDate: string | null;
  selectedValues: FitnessChartValues | null;
}

interface FitnessComputations {
  ftpTrend: TrendDirection | null;
  dominantZone: { name: string; percentage: number } | null;
  currentValues: (FitnessChartValues & { date: string }) | null;
  displayValues: FitnessChartValues | (FitnessChartValues & { date: string }) | null;
  displayDate: string | null | undefined;
  formZone: FormZone | null;
  /** Ramp rate sourced from the intervals.icu wellness payload (CTL points/week). */
  rampRate: number | null;
}

// Rounded loads, so the header's Form matches intervals.icu's display.
function loadsOf(day: WellnessData): FitnessChartValues {
  return {
    fitness: Math.round(day.ctl ?? 0),
    fatigue: Math.round(day.atl ?? 0),
    form: formFromLoads(day.ctl, day.atl),
  };
}

/**
 * Produces the memoized derivations rendered by FitnessScreen.
 *
 * Pure derivations (no side effects, no fetching) over the raw data the screen
 * has already gathered, plus the chart crosshair selection state.
 */
export function useFitnessComputations({
  wellness,
  sportMode,
  powerZones,
  hrZones,
  eftpTrend,
  selectedDate,
  selectedValues,
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
    const sorted = [...zones].sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0];
    if (top.percentage === 0) return null;
    return { name: top.name, percentage: top.percentage };
  }, [sportMode, powerZones, hrZones]);

  // Memoize current (latest) values - only recompute when wellness data changes
  const currentValues = useMemo(() => {
    if (!wellness || wellness.length === 0) return null;
    const latest = wellness.reduce((a, b) => (b.id > a.id ? b : a));
    return { ...loadsOf(latest), date: latest.id };
  }, [wellness]);

  // A date pinned on entry arrives before any chart reports values, so the
  // header reads that day's row itself, and a day with no row shows none.
  const pinnedValues = useMemo(() => {
    if (selectedValues || !selectedDate || !wellness) return null;
    const row = wellness.find((day) => day.id === selectedDate);
    return row ? loadsOf(row) : null;
  }, [wellness, selectedDate, selectedValues]);

  const displayValues = selectedValues ?? (selectedDate ? pinnedValues : currentValues);
  const displayDate = selectedDate || currentValues?.date;
  const asPercent = useFormPreference((s) => s.formAsPercent) === true;
  const formZone = displayValues
    ? getFormZone(displayValues.form, displayValues.fitness, asPercent)
    : null;

  // Ramp rate sourced from intervals.icu's wellness payload - keep our
  // representation aligned with what the web UI shows. It follows the day the
  // header prints, so a scrubbed or pinned day shows its own and none if unlogged.
  const rampRate = useMemo<number | null>(() => {
    if (!wellness || !displayDate) return null;
    return wellness.find((day) => day.id === displayDate)?.rampRate ?? null;
  }, [wellness, displayDate]);

  return {
    ftpTrend,
    dominantZone,
    currentValues,
    displayValues,
    displayDate,
    formZone,
    rampRate,
  };
}
