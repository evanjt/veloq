import { useMemo } from 'react';
import { getFormZone, type FormZone } from '@/lib';
import type { PrimarySport } from '@/providers';
import type { WellnessData, ZoneDistribution, eFTPPoint } from '@/types';

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
  ftpTrend: 'stable' | 'up' | 'down' | null;
  dominantZone: { name: string; percentage: number } | null;
  decouplingValue: { value: number; isGood: boolean } | null;
  currentValues: (FitnessChartValues & { date: string }) | null;
  displayValues: FitnessChartValues | (FitnessChartValues & { date: string }) | null;
  displayDate: string | null | undefined;
  formZone: FormZone | null;
  /** Ramp rate: CTL change over the trailing 7 days (units: CTL points). */
  rampRate: number | null;
  /** Form as percentage of fitness (TSB/CTL*100). Null when fitness is 0. */
  formPercent: number | null;
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
    if (current === previous) return 'stable';
    return current > previous ? 'up' : 'down';
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
    if (power.length < 4 || hr.length < 4) return null;

    const midpoint = Math.floor(power.length / 2);
    const avgFirstPower = power.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgFirstHR = hr.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgSecondPower =
      power.slice(midpoint).reduce((a, b) => a + b, 0) / (power.length - midpoint);
    const avgSecondHR = hr.slice(midpoint).reduce((a, b) => a + b, 0) / (hr.length - midpoint);

    const firstHalfEf = avgFirstPower / avgFirstHR;
    const secondHalfEf = avgSecondPower / avgSecondHR;
    const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;
    const isGood = decoupling < 5;

    return { value: decoupling, isGood };
  }, [decouplingStreams]);

  // Memoize current (latest) values - only recompute when wellness data changes
  const currentValues = useMemo(() => {
    if (!wellness || wellness.length === 0) return null;
    const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
    const latest = sorted[0];
    const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
    const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
    // Use rounded values for form calculation to match intervals.icu display
    const fitness = Math.round(fitnessRaw);
    const fatigue = Math.round(fatigueRaw);
    return { fitness, fatigue, form: fitness - fatigue, date: latest.id };
  }, [wellness]);

  const displayValues = selectedValues || currentValues;
  const displayDate = selectedDate || currentValues?.date;
  const formZone = displayValues ? getFormZone(displayValues.form) : null;

  // Ramp rate: CTL now − CTL seven days ago (in CTL points). Positive means
  // building; negative means detraining. Forum "safety guardrail" for
  // overtraining — +6/week is a common rule of thumb.
  const rampRate = useMemo<number | null>(() => {
    if (!wellness || wellness.length < 8) return null;
    const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id));
    const latest = sorted[sorted.length - 1];
    const weekAgo = sorted[sorted.length - 8];
    const latestCtl = latest.ctl ?? latest.ctlLoad;
    const weekAgoCtl = weekAgo.ctl ?? weekAgo.ctlLoad;
    if (latestCtl == null || weekAgoCtl == null) return null;
    return latestCtl - weekAgoCtl;
  }, [wellness]);

  // Form as % of fitness = TSB / CTL × 100. Null when fitness is 0 or missing.
  const formPercent = useMemo<number | null>(() => {
    if (!displayValues || displayValues.fitness === 0) return null;
    return (displayValues.form / displayValues.fitness) * 100;
  }, [displayValues]);

  return {
    ftpTrend,
    dominantZone,
    decouplingValue,
    currentValues,
    displayValues,
    displayDate,
    formZone,
    rampRate,
    formPercent,
  };
}
