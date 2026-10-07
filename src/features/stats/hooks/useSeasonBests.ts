import { useMemo } from 'react';
import { useBestEfforts, type BestEffortsSport } from './useBestEfforts';
import {
  formatPaceCompact,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { type PrimarySport } from '@/features/fitness';
import type { BestEffortsData } from 'veloqrs';

/** What the climb read says about the rows behind empty windows. */
export interface ClimbStatus {
  /** Activities whose climb rows are still being computed. */
  owed: number;
  /** Activities left out because their elevation is not the corrected series. */
  sourceExcluded: number;
}

export interface BestEffort {
  label: string;
  value: number | null; // watts for power, m/s for pace
  time: number | null; // elapsed time in seconds (pace curves only)
  activityId: string | undefined;
  checkpoint: number; // secs for power, meters for pace
}

/** A climbing best as the rows draw it. */
export interface ClimbBest {
  label: string;
  windowS: number;
  /** Vertical metres per hour. */
  vam: number | null;
  wattsPerKg: number | null;
  activityId: string | undefined;
}

export interface UseSeasonBestsResult {
  efforts: BestEffort[];
  climbing: ClimbBest[];
  climbingStatus: ClimbStatus;
  isLoading: boolean;
  headerSummary: string | null;
}

interface UseSeasonBestsOptions {
  sport: PrimarySport;
  days: number;
}

const API_TYPE: Record<PrimarySport, BestEffortsSport> = {
  Cycling: 'Ride',
  Running: 'Run',
  Swimming: 'Swim',
};

/** One sport's bests from the screen read, as the rows draw them. */
export function bestEffortsOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport
): BestEffort[] {
  const row = data?.sports.find((s) => s.sport === API_TYPE[sport]);
  return (row?.efforts ?? []).map((e) => ({
    label: e.label,
    value: e.value ?? null,
    time: e.time ?? null,
    activityId: e.activityId,
    checkpoint: e.checkpoint,
  }));
}

/** One sport's climbing bests from the screen read: Ride and Run have them, Swim does not. */
export function climbBestsOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport
): ClimbBest[] {
  const row = data?.climbing.find((c) => c.sport === API_TYPE[sport]);
  return (row?.bests ?? []).map((b) => ({
    label: b.label,
    windowS: b.windowS,
    vam: b.vam ?? null,
    wattsPerKg: b.wattsPerKg ?? null,
    activityId: b.activityId,
  }));
}

/** One sport's owed and excluded counts from the climb read, zero when it has no row. */
export function climbStatusOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport
): ClimbStatus {
  const row = data?.climbing.find((c) => c.sport === API_TYPE[sport]);
  return { owed: row?.owed ?? 0, sourceExcluded: row?.sourceExcluded ?? 0 };
}

export function useSeasonBests({ sport, days }: UseSeasonBestsOptions): UseSeasonBestsResult {
  const isMetric = useMetricSystem();
  const shown = useMemo(() => [API_TYPE[sport]], [sport]);
  const { data, isLoading } = useBestEfforts(days, shown);

  const efforts = useMemo((): BestEffort[] => bestEffortsOf(data, sport), [data, sport]);

  const climbing = useMemo((): ClimbBest[] => climbBestsOf(data, sport), [data, sport]);

  const climbingStatus = useMemo(() => climbStatusOf(data, sport), [data, sport]);

  const headerSummary = useMemo((): string | null => {
    if (efforts.length === 0) return null;

    if (sport === 'Cycling') {
      // Show 5m power as the headline
      const fiveMin = efforts.find((e) => e.checkpoint === 300);
      if (fiveMin?.value) return `5m: ${Math.round(fiveMin.value)}w`;
      // Fallback to first non-null
      const first = efforts.find((e) => e.value !== null);
      if (first?.value) return `${first.label}: ${Math.round(first.value)}w`;
      return null;
    }

    if (sport === 'Running') {
      // Show 5K pace as the headline
      const fiveK = efforts.find((e) => e.checkpoint === 5000);
      if (fiveK?.value)
        return `5K: ${formatPaceCompact(fiveK.value, isMetric)}${paceUnitLabel(isMetric)}`;
      const first = efforts.find((e) => e.value !== null);
      if (first?.value)
        return `${first.label}: ${formatPaceCompact(first.value, isMetric)}${paceUnitLabel(isMetric)}`;
      return null;
    }

    if (sport === 'Swimming') {
      // Show 400m pace as the headline
      const fourHundred = efforts.find((e) => e.checkpoint === 400);
      if (fourHundred?.value)
        return `400m: ${formatSwimPace(fourHundred.value, isMetric)}${swimPaceUnitLabel(isMetric)}`;
      const first = efforts.find((e) => e.value !== null);
      if (first?.value)
        return `${first.label}: ${formatSwimPace(first.value, isMetric)}${swimPaceUnitLabel(isMetric)}`;
      return null;
    }

    return null;
  }, [sport, efforts, isMetric]);

  return { efforts, climbing, climbingStatus, isLoading, headerSummary };
}
