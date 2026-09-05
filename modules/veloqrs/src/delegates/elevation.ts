/**
 * Elevation backfill delegates.
 *
 * The backfill re-fetches stored tracks that carry no per-point elevation and
 * re-cuts the catalogue once at the end. Both calls are standalone UniFFI
 * exports rather than engine methods, so they read from the generated module.
 */

import {
  startElevationBackfill as ffiStartElevationBackfill,
  pauseElevationBackfill as ffiPauseElevationBackfill,
  getElevationBackfillProgress as ffiGetElevationBackfillProgress,
  getElevationBackfillRemaining as ffiGetElevationBackfillRemaining,
  type ElevationBackfillProgress,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * Live and terminal states the backfill reports. `paused` is the athlete's
 * own stop: it holds for the process and lifts on the next launch.
 */
export type ElevationBackfillPhase =
  | 'idle'
  | 'fetching'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'paused';

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
    console.error('[Engine] startElevationBackfill threw:', e);
    return false;
  }
}

/**
 * Pause the backfill for the rest of this process. The pass in flight ends at
 * its next batch and reports `paused`, nothing starts another until the app
 * is reopened, and nothing is persisted. Returns whether a pass was running.
 */
export function pauseElevationBackfill(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('pauseElevationBackfill', () => ffiPauseElevationBackfill());
  } catch (e) {
    console.error('[Engine] pauseElevationBackfill threw:', e);
    return false;
  }
}

/**
 * How many stored tracks the backfill still has to ask upstream about. Zero
 * is the definitive "nothing left to do" the launch trigger stamps on, so an
 * engine that is not ready answers null, never zero. Rust raises rather than
 * answering zero for the same reason, so a locked database lands in the catch
 * below and reads as null too.
 */
export function getElevationBackfillRemaining(host: DelegateHost): number | null {
  if (!host.ready) return null;
  try {
    return host.timed('getElevationBackfillRemaining', () => ffiGetElevationBackfillRemaining());
  } catch (e) {
    console.error('[Engine] getElevationBackfillRemaining threw:', e);
    return null;
  }
}

/** Read the backfill's progress. Null when the engine is not ready. */
export function getElevationBackfillProgress(host: DelegateHost): ElevationBackfillProgress | null {
  if (!host.ready) return null;
  try {
    return host.timed('getElevationBackfillProgress', () => ffiGetElevationBackfillProgress());
  } catch (e) {
    console.error('[Engine] getElevationBackfillProgress threw:', e);
    return null;
  }
}
