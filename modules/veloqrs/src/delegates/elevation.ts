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
  resumeElevationBackfill as ffiResumeElevationBackfill,
  isElevationBackfillPaused as ffiIsElevationBackfillPaused,
  getElevationBackfillProgress as ffiGetElevationBackfillProgress,
  getElevationBackfillRemaining as ffiGetElevationBackfillRemaining,
  type ElevationBackfillProgress,
  FfiStartOutcome,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * Live and terminal states the backfill reports. `paused` is the athlete's
 * own stop: it holds until they resume it or the app is next launched.
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
 * Ask Rust to start the backfill. Safe to call on every launch: the verdict
 * names the refusal, so `NotOwed`, which is the job finished, is not read as
 * the same failure as being offline or having no credential yet.
 */
export function startElevationBackfill(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  try {
    return host.timed('startElevationBackfill', () => ffiStartElevationBackfill());
  } catch (e) {
    console.error('[Engine] startElevationBackfill threw:', e);
    return FfiStartOutcome.Failed;
  }
}

/**
 * Pause the backfill for the rest of this process. The pass in flight ends at
 * its next batch and reports `paused`, nothing starts another until the athlete
 * resumes or the app is reopened, and nothing is persisted. The phase is what
 * says it is paused, so there is nothing to return.
 */
export function pauseElevationBackfill(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('pauseElevationBackfill', () => ffiPauseElevationBackfill());
  } catch (e) {
    console.error('[Engine] pauseElevationBackfill threw:', e);
  }
}

/**
 * Lift a pause and put the download back to work. Returns whether there was a
 * pause to lift, so a second press answers false rather than starting twice.
 */
export function resumeElevationBackfill(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('resumeElevationBackfill', () => ffiResumeElevationBackfill());
  } catch (e) {
    console.error('[Engine] resumeElevationBackfill threw:', e);
    return false;
  }
}

/**
 * Whether the athlete has paused the download in this process. The phase
 * carries the same fact while it is at rest, but a pass that ends after a
 * pause overwrites it, so this is the one that stays true.
 */
export function isElevationBackfillPaused(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return ffiIsElevationBackfillPaused();
  } catch (e) {
    console.error('[Engine] isElevationBackfillPaused threw:', e);
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
