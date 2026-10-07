/**
 * Stream backfill delegates.
 *
 * The retention window used to default to ninety days, so on an existing
 * install most of the library downloaded only the three series the track needs
 * and its cadence, heart rate, power and temperature were never asked for.
 * Widening the default fixed the next sync and nothing already stored. This
 * pass goes back for them, and unlike the elevation backfill nothing starts it
 * at launch: it is tens of megabytes on the athlete's own connection, so the
 * settings screen offers it and the athlete decides.
 */

import {
  startStreamBackfill as ffiStartStreamBackfill,
  stopStreamBackfill as ffiStopStreamBackfill,
  consentStreamBackfill as ffiConsentStreamBackfill,
  getStreamBackfillProgress as ffiGetStreamBackfillProgress,
  getStreamBackfillRemaining as ffiGetStreamBackfillRemaining,
  type StreamBackfillProgress,
  FfiStartOutcome,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * Live and terminal states the pass reports. `stopped` is the athlete's own
 * stop, `partial` is the connection going away, and both mean the same thing
 * for the queue: the rows the pass did not reach are unchanged.
 * `awaiting_consent` is the engine holding a queue past the large-download
 * threshold until the athlete answers.
 */
export const STREAM_PHASES = [
  'idle',
  'fetching',
  'complete',
  'partial',
  'stopped',
  'failed',
  'awaiting_consent',
] as const;

export type StreamBackfillPhase = (typeof STREAM_PHASES)[number];

export type { StreamBackfillProgress };

/**
 * Ask Rust to start a pass. The verdict names the refusal, so `NotOwed`, which
 * is the library already stocked, is not read as the same failure as being
 * offline or having no credential yet.
 */
export function startStreamBackfill(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  try {
    return host.timed('startStreamBackfill', () => ffiStartStreamBackfill());
  } catch (e) {
    console.error('[Engine] startStreamBackfill threw:', e);
    return FfiStartOutcome.Failed;
  }
}

/**
 * Record the athlete's yes to a large automatic download and start the pass.
 * Later automatic starts skip the ask.
 */
export function consentStreamBackfill(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  try {
    return host.timed('consentStreamBackfill', () => ffiConsentStreamBackfill());
  } catch (e) {
    console.error('[Engine] consentStreamBackfill threw:', e);
    return FfiStartOutcome.Failed;
  }
}

/**
 * Ask the pass in flight to stop. It ends at its next batch boundary, so what
 * is already stored stays stored and nothing is half written. Stopping a pass
 * held for the athlete's answer is the no.
 */
export function stopStreamBackfill(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('stopStreamBackfill', () => ffiStopStreamBackfill());
  } catch (e) {
    console.error('[Engine] stopStreamBackfill threw:', e);
  }
}

/**
 * How many activities the pass still has to ask about. Zero is the library
 * fully stocked for the window as it stands, so an engine that is not ready
 * answers null rather than zero: the row offers the download off this number
 * and must not hide it because the engine was late.
 */
export function getStreamBackfillRemaining(host: DelegateHost): number | null {
  if (!host.ready) return null;
  return host.timed('getStreamBackfillRemaining', () => ffiGetStreamBackfillRemaining());
}

/** Read the pass's progress. Null when the engine is not ready. */
export function getStreamBackfillProgress(host: DelegateHost): StreamBackfillProgress | null {
  if (!host.ready) return null;
  return host.timed('getStreamBackfillProgress', () => ffiGetStreamBackfillProgress());
}
