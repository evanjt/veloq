/**
 * Elevation backfill delegates.
 *
 * The backfill re-fetches stored tracks that carry no per-point elevation and
 * re-cuts the catalogue once at the end. Both calls are standalone UniFFI
 * exports rather than engine methods, so they read from the generated module.
 */

import {
  startElevationBackfill as ffiStartElevationBackfill,
  getElevationBackfillProgress as ffiGetElevationBackfillProgress,
  getElevationBackfillRemaining as ffiGetElevationBackfillRemaining,
  type ElevationBackfillProgress,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/** Live and terminal states the backfill reports. */
export type ElevationBackfillPhase = 'idle' | 'fetching' | 'complete' | 'partial' | 'failed';

export type { ElevationBackfillProgress };

/**
 * Ask Rust to start the backfill. Returns false when nothing is outstanding,
 * when a run is already in flight, or when no credential is set, so it is safe
 * to call on every launch.
 */
export function startElevationBackfill(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('startElevationBackfill', () => ffiStartElevationBackfill());
  } catch (e) {
    console.error('[RouteEngine] startElevationBackfill threw:', e);
    return false;
  }
}

/**
 * How many stored tracks the backfill still has to ask upstream about. Zero
 * is the definitive "nothing left to do" the launch trigger stamps on, so an
 * engine that is not ready answers null, never zero.
 */
export function getElevationBackfillRemaining(host: DelegateHost): number | null {
  if (!host.ready) return null;
  try {
    return host.timed('getElevationBackfillRemaining', () => ffiGetElevationBackfillRemaining());
  } catch (e) {
    console.error('[RouteEngine] getElevationBackfillRemaining threw:', e);
    return null;
  }
}

/** Read the backfill's progress. Null when the engine is not ready. */
export function getElevationBackfillProgress(host: DelegateHost): ElevationBackfillProgress | null {
  if (!host.ready) return null;
  try {
    return host.timed('getElevationBackfillProgress', () => ffiGetElevationBackfillProgress());
  } catch (e) {
    console.error('[RouteEngine] getElevationBackfillProgress threw:', e);
    return null;
  }
}
