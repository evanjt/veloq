/**
 * W' balance (anaerobic work capacity) stream computation for an activity.
 *
 * Delegates the arithmetic to Rust via `computeWbal` so a 10k-sample stream
 * stays off the JS thread. Uses the per-activity `icu_ftp` when available
 * (falls back to the athlete's FTP from sport settings), and the athlete's
 * `wPrime` when set (falls back to `DEFAULT_W_PRIME_JOULES`).
 *
 * Returns `undefined` when no power stream is present or FTP is unknown —
 * in that case the W'bal chart chip is not shown.
 */
import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { Activity, ActivityStreams, Athlete, SportSettings } from '@/types';
import { DEFAULT_W_PRIME_JOULES } from '@/types';

function ftpFromSportSettings(
  settings: SportSettings[] | undefined,
  activityType: string | undefined
): number | undefined {
  if (!settings || !activityType) return undefined;
  const match = settings.find((s) => s.types?.includes(activityType));
  return match?.ftp;
}

function sampleIntervalSecs(timeStream: number[] | undefined): number {
  if (!timeStream || timeStream.length < 2) return 1;
  const dt = timeStream[1] - timeStream[0];
  if (!Number.isFinite(dt) || dt <= 0) return 1;
  return Math.max(1, Math.round(dt));
}

export function useWbalStream(
  activity: Activity | undefined,
  streams: ActivityStreams | undefined,
  athlete: Athlete | null | undefined,
  sportSettings: SportSettings[] | undefined
): number[] | undefined {
  return useMemo(() => {
    const watts = streams?.watts;
    if (!watts || watts.length === 0) return undefined;

    const cp = activity?.icu_ftp ?? ftpFromSportSettings(sportSettings, activity?.type);
    if (!Number.isFinite(cp) || !cp || cp <= 0) return undefined;

    const wPrime = athlete?.wPrime && athlete.wPrime > 0 ? athlete.wPrime : DEFAULT_W_PRIME_JOULES;

    const engine = getRouteEngine();
    if (!engine) return undefined;

    const dt = sampleIntervalSecs(streams?.time);
    const result = engine.computeWbal(watts, cp, wPrime, dt);
    return result.length === watts.length ? result : undefined;
  }, [
    activity?.icu_ftp,
    activity?.type,
    athlete?.wPrime,
    sportSettings,
    streams?.watts,
    streams?.time,
  ]);
}
