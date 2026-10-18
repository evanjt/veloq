import { useMemo } from 'react';
import { useBestEfforts, type BestEffortsSport } from './useBestEfforts';
import {
  formatDurationHuman,
  formatPaceCompact,
  formatPower,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
  epochDayKeyUtc,
} from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { bestEffortCheckpointLabel, type PrimarySport } from '@/features/fitness';
import type { BestEffortsData, BestEffort as ReadBestEffort } from 'veloqrs';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/** What the climb read says about the rows behind empty windows. */
export interface ClimbStatus {
  /** Activities whose climb rows are still being computed. */
  owed: number;
  /** Activities left out because their elevation is not the corrected series. */
  sourceExcluded: number;
}

/** The activity a best was set in, as a row names it. */
export interface BestActivityLabel {
  name: string;
  /** The start's `YYYY-MM-DD` day. */
  date: string;
}

export interface BestEffort {
  /** The checkpoint in the athlete's language. */
  label: string;
  value: number | null; // watts for power, m/s for pace
  time: number | null; // elapsed time in seconds (pace curves only)
  activityId: string | undefined;
  /** Empty when the device does not hold the activity, which the row shows as not cached. */
  activity: BestActivityLabel | undefined;
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
  activity: BestActivityLabel | undefined;
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

/** The engine's name for each sport the bests are read under. */
export const BEST_EFFORTS_SPORT: Record<PrimarySport, BestEffortsSport> = {
  Cycling: 'Ride',
  Running: 'Run',
  Swimming: 'Swim',
};

/**
 * The name and day the read gives the activity holding a best. The start is the
 * wall clock stamped as UTC, so its day is read in UTC: a local reading moves a
 * late start onto the next or previous day.
 */
function bestActivityLabel(activity: ReadBestEffort['activity']): BestActivityLabel | undefined {
  return activity && { name: activity.name, date: epochDayKeyUtc(activity.date) };
}

/** One sport's bests from the screen read, as the rows draw them. */
export function bestEffortsOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport,
  t: TFunction
): BestEffort[] {
  const row = data?.sports.find((s) => s.sport === BEST_EFFORTS_SPORT[sport]);
  // Power checkpoints are durations, written in the locale's units; pace
  // checkpoints are distances and keep the read's label.
  return (row?.efforts ?? []).map((e) => ({
    label: bestEffortCheckpointLabel(e, t),
    value: e.value ?? null,
    time: e.time ?? null,
    activityId: e.activityId,
    activity: bestActivityLabel(e.activity),
    checkpoint: e.checkpoint,
  }));
}

/** One sport's climbing bests from the screen read: Ride and Run have them, Swim does not. */
export function climbBestsOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport
): ClimbBest[] {
  const row = data?.climbing.find((c) => c.sport === BEST_EFFORTS_SPORT[sport]);
  return (row?.bests ?? []).map((b) => ({
    label: formatDurationHuman(b.windowS),
    windowS: b.windowS,
    vam: b.vam ?? null,
    wattsPerKg: b.wattsPerKg ?? null,
    activityId: b.activityId,
    activity: bestActivityLabel(b.activity),
  }));
}

/** One sport's owed and excluded counts from the climb read, zero when it has no row. */
export function climbStatusOf(
  data: BestEffortsData | null | undefined,
  sport: PrimarySport
): ClimbStatus {
  const row = data?.climbing.find((c) => c.sport === BEST_EFFORTS_SPORT[sport]);
  return { owed: row?.owed ?? 0, sourceExcluded: row?.sourceExcluded ?? 0 };
}

export function useSeasonBests({ sport, days }: UseSeasonBestsOptions): UseSeasonBestsResult {
  const isMetric = useMetricSystem();
  const shown = useMemo(() => [BEST_EFFORTS_SPORT[sport]], [sport]);
  const { data, isLoading } = useBestEfforts(days, shown);

  const { t } = useTranslation();
  const efforts = useMemo((): BestEffort[] => bestEffortsOf(data, sport, t), [data, sport, t]);

  const climbing = useMemo((): ClimbBest[] => climbBestsOf(data, sport), [data, sport]);

  const climbingStatus = useMemo(() => climbStatusOf(data, sport), [data, sport]);

  const headerSummary = useMemo((): string | null => {
    if (efforts.length === 0) return null;

    if (sport === 'Cycling') {
      // Show five-minute power as the headline
      const fiveMin = efforts.find((e) => e.checkpoint === 300);
      if (fiveMin?.value) return `${fiveMin.label}: ${formatPower(fiveMin.value)}`;
      // Fallback to first non-null
      const first = efforts.find((e) => e.value !== null);
      if (first?.value) return `${first.label}: ${formatPower(first.value)}`;
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
