/**
 * Gradient-Adjusted Pace (GAP) stream computation for an activity.
 *
 * Delegates the Minetti cost-of-transport math to Rust via `computeGapStream`
 * so a 5-10k sample stream stays off the JS thread. Derives the gradient
 * stream from `streams.altitude` + `streams.distance` using the same sliding
 * window helper (`computeGradientStream`) that powers the gradient chart.
 *
 * Returns `undefined` when:
 *   - the engine is unavailable
 *   - no velocity/distance stream exists to derive raw pace
 *   - altitude or distance is missing (gradient not derivable)
 *   - the FFI call returns a mismatched-length result
 *
 * When `undefined` the GAP chart chip is not shown.
 *
 * Minetti, A. E., et al. (2002) "Energy cost of walking and running at
 * extreme uphill and downhill slopes." J. Appl. Physiol. 93(3):1039-1046.
 */
import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { computeGradientStream } from '@/lib/utils/chartConfig';
import type { Activity, ActivityStreams } from '@/types';

/** Raw pace in min/km from the velocity_smooth stream (m/s). */
function velocityToPaceMinPerKm(velocity: number[] | undefined): number[] | undefined {
  if (!velocity || velocity.length === 0) return undefined;
  return velocity.map((v) => (Number.isFinite(v) && v > 0 ? 1000 / v / 60 : 0));
}

export function useGapStream(
  _activity: Activity | undefined,
  streams: ActivityStreams | undefined
): number[] | undefined {
  return useMemo(() => {
    const pace = velocityToPaceMinPerKm(streams?.velocity_smooth);
    if (!pace) return undefined;

    // Gradient stream is derived from altitude + distance; without both we
    // cannot compute a meaningful adjustment.
    const gradient = computeGradientStream(streams?.altitude, streams?.distance);
    if (!gradient) return undefined;

    const n = Math.min(pace.length, gradient.length);
    if (n === 0) return undefined;

    const engine = getRouteEngine();
    if (!engine) return undefined;

    const paceAligned = pace.slice(0, n);
    const gradientAligned = gradient.slice(0, n);

    const result = engine.computeGapStream(paceAligned, gradientAligned);
    return result.length === n ? result : undefined;
  }, [streams?.velocity_smooth, streams?.altitude, streams?.distance]);
}
