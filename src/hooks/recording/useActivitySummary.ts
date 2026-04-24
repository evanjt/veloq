import { useMemo, useCallback } from 'react';
import type { RecordingStreams } from '@/types/recording';

export interface ActivitySummary {
  duration: number;
  distance: number;
  avgSpeed: number;
  elevationGain: number;
  avgHeartrate: number | null;
  avgPower: number | null;
  hasGps: boolean;
}

export interface TrimDelta {
  distance: number;
  duration: number;
}

export interface UseActivitySummaryArgs {
  streams: RecordingStreams;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  trimStart: number;
  trimEnd: number;
  canTrim: boolean;
  isManual: boolean;
  /**
   * For manual entries, the duration/distance/HR values are passed in via route
   * params (as strings). These are the pre-parsed source params from
   * `useLocalSearchParams`.
   */
  params: {
    durationSeconds?: string;
    distance?: string;
    avgHr?: string;
  };
}

export interface UseActivitySummary {
  summary: ActivitySummary;
  trimDelta: TrimDelta | null;
  getTrimmedStreams: () => RecordingStreams;
}

/**
 * Derives the activity summary (duration, distance, HR, elevation) and
 * the trim delta (difference vs full recording) from recorded streams.
 *
 * - `getTrimmedStreams()` returns sliced stream arrays for the currently
 *   selected trim window, or the original streams when trimming is not
 *   applicable.
 * - For manual entries (no GPS), duration/distance/HR come from route params
 *   and elevation is fixed at 0.
 */
export function useActivitySummary({
  streams,
  startTime,
  stopTime,
  pausedDuration,
  trimStart,
  trimEnd,
  canTrim,
  isManual,
  params,
}: UseActivitySummaryArgs): UseActivitySummary {
  // Get trimmed streams for upload
  const getTrimmedStreams = useCallback(() => {
    if (!canTrim) return streams;
    return {
      latlng: streams.latlng.slice(trimStart, trimEnd + 1),
      altitude: streams.altitude.slice(trimStart, trimEnd + 1),
      distance: streams.distance.slice(trimStart, trimEnd + 1),
      heartrate: streams.heartrate.slice(trimStart, trimEnd + 1),
      power: streams.power.slice(trimStart, trimEnd + 1),
      cadence: streams.cadence.slice(trimStart, trimEnd + 1),
      speed: streams.speed.slice(trimStart, trimEnd + 1),
      time: streams.time.slice(trimStart, trimEnd + 1),
    };
  }, [canTrim, streams, trimStart, trimEnd]);

  // Compute summary stats (with optional trimming)
  const summary = useMemo<ActivitySummary>(() => {
    if (isManual) {
      const durationSec = params.durationSeconds ? Number(params.durationSeconds) : 0;
      const distanceM = params.distance ? Number(params.distance) : 0;
      const avgHeartrate = params.avgHr ? Number(params.avgHr) : null;
      return {
        duration: durationSec,
        distance: distanceM,
        avgSpeed: durationSec > 0 && distanceM > 0 ? distanceM / durationSec : 0,
        elevationGain: 0,
        avgHeartrate,
        avgPower: null as number | null,
        hasGps: false,
      };
    }

    const s = canTrim ? getTrimmedStreams() : streams;

    const startDist = canTrim ? (streams.distance[trimStart] ?? 0) : 0;
    const endDist = canTrim
      ? (streams.distance[trimEnd] ?? 0)
      : (streams.distance[streams.distance.length - 1] ?? 0);
    const totalDistance = endDist - startDist;

    const elapsed = startTime
      ? canTrim && s.time.length >= 2
        ? (s.time[s.time.length - 1] - s.time[0]) / 1000
        : ((stopTime ?? Date.now()) - startTime - pausedDuration) / 1000
      : 0;

    // Calculate elevation gain
    let elevGain = 0;
    for (let i = 1; i < s.altitude.length; i++) {
      const diff = s.altitude[i] - s.altitude[i - 1];
      if (diff > 0) elevGain += diff;
    }

    // Average heartrate
    const hrValues = s.heartrate.filter((v) => v > 0);
    const avgHr =
      hrValues.length > 0 ? hrValues.reduce((sum, v) => sum + v, 0) / hrValues.length : null;

    // Average power
    const pwrValues = s.power.filter((v) => v > 0);
    const avgPwr =
      pwrValues.length > 0 ? pwrValues.reduce((sum, v) => sum + v, 0) / pwrValues.length : null;

    return {
      duration: elapsed,
      distance: totalDistance,
      avgSpeed: elapsed > 0 ? totalDistance / elapsed : 0,
      elevationGain: elevGain,
      avgHeartrate: avgHr,
      avgPower: avgPwr,
      hasGps: s.latlng.length > 0,
    };
  }, [
    isManual,
    params,
    streams,
    startTime,
    stopTime,
    pausedDuration,
    canTrim,
    trimStart,
    trimEnd,
    getTrimmedStreams,
  ]);

  // Compute trim delta when trimming is active
  const trimDelta = useMemo<TrimDelta | null>(() => {
    if (!canTrim || (trimStart === 0 && trimEnd === streams.latlng.length - 1)) return null;

    const fullDist =
      (streams.distance[streams.distance.length - 1] ?? 0) - (streams.distance[0] ?? 0);
    const fullElapsed =
      startTime && streams.time.length >= 2
        ? (streams.time[streams.time.length - 1] - streams.time[0]) / 1000
        : 0;

    const distDelta = summary.distance - fullDist;
    const durationDelta = summary.duration - fullElapsed;

    if (distDelta === 0 && durationDelta === 0) return null;
    return { distance: distDelta, duration: durationDelta };
  }, [canTrim, trimStart, trimEnd, streams, startTime, summary]);

  return { summary, trimDelta, getTrimmedStreams };
}
