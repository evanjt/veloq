import { useMemo } from 'react';

import { calculateDecoupling } from '@/features/stats';
import { type PrimarySport } from '@/features/fitness/stores';
import type { WellnessData, ZoneDistribution, eFTPPoint } from '@/types';
import { getFormZone, type FormZone } from '../lib';
import { trendOfMetric, type TrendDirection } from '@/shared/format/trend';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formFromLoads } from '@/shared/math';

interface DecouplingStreams {
  watts?: number[];
  heartrate?: number[];
}

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
  eftpHistory: eFTPPoint[] | undefined;
  decouplingStreams: DecouplingStreams | undefined;
  selectedDate: string | null;
  selectedValues: FitnessChartValues | null;
}

interface FitnessComputations {
  ftpTrend: TrendDirection | null;
  dominantZone: { name: string; percentage: number } | null;
  decouplingValue: { value: number; isGood: boolean } | null;
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
  eftpHistory,
  decouplingStreams,
  selectedDate,
  selectedValues,
}: UseFitnessComputationsArgs): FitnessComputations {
  // Compute FTP trend (compare current to avg of previous values)
  const ftpTrend = useMemo<FitnessComputations['ftpTrend']>(() => {
    if (!eftpHistory || eftpHistory.length < 2) return null;
    const current = eftpHistory[eftpHistory.length - 1].eftp;
    const previous = eftpHistory[eftpHistory.length - 2].eftp;
    return trendOfMetric('ftp', current, previous);
  }, [eftpHistory]);

  // Compute dominant zone for header display
  const dominantZone = useMemo(() => {
    const zones = sportMode === 'Cycling' ? powerZones : hrZones;
    if (!zones || zones.length === 0) return null;
    const sorted = [...zones].sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0];
    if (top.percentage === 0) return null;
    return { name: top.name, percentage: top.percentage };
  }, [sportMode, powerZones, hrZones]);

  // Compute decoupling percentage for header display
  const decouplingValue = useMemo(() => {
    if (!decouplingStreams?.watts || !decouplingStreams?.heartrate) return null;
    const power = decouplingStreams.watts;
    const hr = decouplingStreams.heartrate;
    const analysis = calculateDecoupling(power, hr);
    if (!analysis) return null;

    return { value: analysis.decoupling, isGood: analysis.isGood };
  }, [decouplingStreams]);

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
    decouplingValue,
    currentValues,
    displayValues,
    displayDate,
    formZone,
    rampRate,
  };
}
