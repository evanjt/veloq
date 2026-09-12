import { useMemo, useCallback } from 'react';

import type { RecordingStreams } from '@/features/recording/types';
import { pausedSecondsBetween, type PauseInterval } from '../lib/pausedTime';
import { parseManualSummary } from '../lib/parseManualSummary';
import { buildStreamPrefixes, windowAverage, windowGain } from '../lib/streamPrefixes';

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
  pauseIntervals: readonly PauseInterval[];
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
  /** Paused seconds inside the saved window, for the FIT writer's timer time. */
  pausedSecondsInWindow: number;
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
  pauseIntervals,
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

  // Built once per recording. A trim handle moves once a frame and the
  // window's gain and averages come out of these in constant time, so a drag
  // no longer walks the whole ride per frame.
  const prefixes = useMemo(() => buildStreamPrefixes(streams), [streams]);

  // The inclusive point range actually being saved. Empty streams give an
  // empty range rather than a negative one, so every reader below can index.
  const savedWindow = useMemo<[number, number]>(() => {
    const last = streams.time.length - 1;
    if (last < 0) return [0, -1];
    const from = canTrim ? Math.max(0, Math.min(trimStart, last)) : 0;
    const to = Math.max(from, Math.min(canTrim ? trimEnd : last, last));
    return [from, to];
  }, [streams, canTrim, trimStart, trimEnd]);

  // Compute summary stats (with optional trimming)
  const summary = useMemo<ActivitySummary>(() => {
    if (isManual) {
      // Route params are free-form strings; a non-numeric value must not save as NaN.
      const manual = parseManualSummary(params);
      return {
        ...manual,
        elevationGain: 0,
        avgPower: null as number | null,
        hasGps: false,
      };
    }

    const [from, to] = savedWindow;

    const startDist = canTrim ? (streams.distance[trimStart] ?? 0) : 0;
    const endDist = canTrim
      ? (streams.distance[trimEnd] ?? 0)
      : (streams.distance[streams.distance.length - 1] ?? 0);
    const totalDistance = endDist - startDist;

    // Stream time values are seconds; startTime/stopTime are milliseconds. Stream
    // times run on wall clock, so a window measured from them still holds its pauses.
    const elapsed = startTime
      ? canTrim && to - from >= 1
        ? Math.max(
            0,
            streams.time[to] -
              streams.time[from] -
              pausedSecondsBetween(pauseIntervals, streams.time[from], streams.time[to])
          )
        : ((stopTime ?? Date.now()) - startTime - pausedDuration) / 1000
      : 0;

    const elevGain = windowGain(prefixes, from, to);
    const avgHr = windowAverage(prefixes.hrSum, prefixes.hrCount, prefixes, from, to);
    const avgPwr = windowAverage(prefixes.powerSum, prefixes.powerCount, prefixes, from, to);

    const points = Math.min(to, streams.latlng.length - 1) - from + 1;

    return {
      duration: elapsed,
      distance: totalDistance,
      avgSpeed: elapsed > 0 ? totalDistance / elapsed : 0,
      elevationGain: elevGain,
      avgHeartrate: avgHr,
      avgPower: avgPwr,
      hasGps: points > 0,
    };
  }, [
    isManual,
    params,
    streams,
    startTime,
    stopTime,
    pausedDuration,
    pauseIntervals,
    canTrim,
    trimStart,
    trimEnd,
    prefixes,
    savedWindow,
  ]);

  // Compute trim delta when trimming is active
  const trimDelta = useMemo<TrimDelta | null>(() => {
    if (!canTrim || (trimStart === 0 && trimEnd === streams.latlng.length - 1)) return null;

    const fullDist =
      (streams.distance[streams.distance.length - 1] ?? 0) - (streams.distance[0] ?? 0);
    const fullElapsed =
      startTime && streams.time.length >= 2
        ? Math.max(
            0,
            streams.time[streams.time.length - 1] -
              streams.time[0] -
              pausedSecondsBetween(
                pauseIntervals,
                streams.time[0],
                streams.time[streams.time.length - 1]
              )
          )
        : 0;

    const distDelta = summary.distance - fullDist;
    const durationDelta = summary.duration - fullElapsed;

    if (distDelta === 0 && durationDelta === 0) return null;
    return { distance: distDelta, duration: durationDelta };
  }, [canTrim, trimStart, trimEnd, streams, startTime, pauseIntervals, summary]);

  // Pauses inside the window actually saved, whether trimmed or whole.
  const pausedSecondsInWindow = useMemo(() => {
    if (isManual) return 0;
    const [from, to] = savedWindow;
    if (to - from < 1) return pausedDuration / 1000;
    return pausedSecondsBetween(pauseIntervals, streams.time[from], streams.time[to]);
  }, [isManual, savedWindow, streams, pauseIntervals, pausedDuration]);

  return { summary, trimDelta, getTrimmedStreams, pausedSecondsInWindow };
}
