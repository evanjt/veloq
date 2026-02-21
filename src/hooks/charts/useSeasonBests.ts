import { useMemo } from 'react';
import { usePowerCurve, getIndexAtDuration } from './usePowerCurve';
import { usePaceCurve, getIndexAtDistance, getTimeAtDistance } from './usePaceCurve';
import { formatPaceCompact, formatSwimPace } from '@/lib';
import type { PrimarySport } from '@/providers';

export interface BestEffort {
  label: string;
  value: number | null; // watts for power, m/s for pace
  time: number | null; // elapsed time in seconds (pace curves only)
  activityId: string | undefined;
  checkpoint: number; // secs for power, meters for pace
}

export interface UseSeasonBestsResult {
  efforts: BestEffort[];
  isLoading: boolean;
  headerSummary: string | null;
}

interface UseSeasonBestsOptions {
  sport: PrimarySport;
  days: number;
}

const CYCLING_CHECKPOINTS = [
  { secs: 5, label: '5s' },
  { secs: 60, label: '1m' },
  { secs: 300, label: '5m' },
  { secs: 1200, label: '20m' },
  { secs: 3600, label: '1h' },
];

const RUNNING_CHECKPOINTS = [
  { meters: 400, label: '400m' },
  { meters: 1000, label: '1K' },
  { meters: 5000, label: '5K' },
  { meters: 10000, label: '10K' },
  { meters: 21097.5, label: 'Half' },
];

const SWIMMING_CHECKPOINTS = [
  { meters: 100, label: '100m' },
  { meters: 200, label: '200m' },
  { meters: 400, label: '400m' },
  { meters: 1500, label: '1500m' },
];

function sportToApiType(sport: PrimarySport): string {
  switch (sport) {
    case 'Cycling':
      return 'Ride';
    case 'Running':
      return 'Run';
    case 'Swimming':
      return 'Swim';
  }
}

export function useSeasonBests({ sport, days }: UseSeasonBestsOptions): UseSeasonBestsResult {
  const apiSport = sportToApiType(sport);

  const { data: powerCurve, isLoading: loadingPower } = usePowerCurve({
    sport: apiSport,
    days,
    enabled: sport === 'Cycling',
  });

  const { data: paceCurve, isLoading: loadingPace } = usePaceCurve({
    sport: apiSport,
    days,
    enabled: sport === 'Running' || sport === 'Swimming',
  });

  const efforts = useMemo((): BestEffort[] => {
    if (sport === 'Cycling') {
      if (!powerCurve?.secs || !powerCurve?.watts) return [];
      return CYCLING_CHECKPOINTS.map(({ secs, label }) => {
        const index = getIndexAtDuration(powerCurve, secs);
        return {
          label,
          value: index !== null ? (powerCurve.watts[index] ?? null) : null,
          time: null,
          activityId: index !== null ? powerCurve.activity_ids?.[index] : undefined,
          checkpoint: secs,
        };
      });
    }

    if (sport === 'Running') {
      if (!paceCurve?.distances || !paceCurve?.pace) return [];
      return RUNNING_CHECKPOINTS.map(({ meters, label }) => {
        const index = getIndexAtDistance(paceCurve, meters);
        return {
          label,
          value: index !== null ? (paceCurve.pace[index] ?? null) : null,
          time: getTimeAtDistance(paceCurve, meters),
          activityId: index !== null ? paceCurve.activity_ids?.[index] : undefined,
          checkpoint: meters,
        };
      });
    }

    if (sport === 'Swimming') {
      if (!paceCurve?.distances || !paceCurve?.pace) return [];
      return SWIMMING_CHECKPOINTS.map(({ meters, label }) => {
        const index = getIndexAtDistance(paceCurve, meters);
        return {
          label,
          value: index !== null ? (paceCurve.pace[index] ?? null) : null,
          time: getTimeAtDistance(paceCurve, meters),
          activityId: index !== null ? paceCurve.activity_ids?.[index] : undefined,
          checkpoint: meters,
        };
      });
    }

    return [];
  }, [sport, powerCurve, paceCurve]);

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
      if (fiveK?.value) return `5K: ${formatPaceCompact(fiveK.value)}/km`;
      const first = efforts.find((e) => e.value !== null);
      if (first?.value) return `${first.label}: ${formatPaceCompact(first.value)}/km`;
      return null;
    }

    if (sport === 'Swimming') {
      // Show 400m pace as the headline
      const fourHundred = efforts.find((e) => e.checkpoint === 400);
      if (fourHundred?.value) return `400m: ${formatSwimPace(fourHundred.value)}/100m`;
      const first = efforts.find((e) => e.value !== null);
      if (first?.value) return `${first.label}: ${formatSwimPace(first.value)}/100m`;
      return null;
    }

    return null;
  }, [sport, efforts]);

  const isLoading = sport === 'Cycling' ? loadingPower : loadingPace;

  return { efforts, isLoading, headerSummary };
}
