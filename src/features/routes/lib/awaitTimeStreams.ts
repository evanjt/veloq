/**
 * Waits for the `time` streams a batch of activities is missing.
 *
 * Rust announces each stream as it lands and the announcement names the
 * activity, so the wait reads nothing from the engine: what is still
 * outstanding is tracked here. A stream the server does not hold never lands,
 * which is what the timeout is for.
 */

import { engine, hasStarted, startOutcome, StartOutcome, type StartResult } from 'veloqrs';

import { awaitEngineAnnouncement } from '@/shared/native/awaitEngineAnnouncement';

/** The channel `EngineObserver.time_streams_stored` lands on. */
const STORED_CHANNEL = 'timeStreamsStored';

/**
 * Whether a start will announce the streams it was asked for. A busy key is the
 * same batch already in flight, which announces them; any other refusal fetches
 * nothing, so waiting on it only holds the caller until its deadline.
 */
export function willAnnounce(start: StartResult): boolean {
  return hasStarted(start) || startOutcome(start) === StartOutcome.Busy;
}

export interface AwaitTimeStreamsOptions {
  /** Give up after this long, whatever is still outstanding. */
  timeoutMs: number;
  /** Ends the wait early, for a caller that has gone away. */
  signal?: AbortSignal | undefined;
  /** How many are still outstanding, called as each announcement lands. */
  onProgress?: ((remaining: number) => void) | undefined;
}

/** Resolves with how many of `activityIds` were still outstanding at the end. */
export function awaitTimeStreams(
  activityIds: string[],
  { timeoutMs, signal, onProgress }: AwaitTimeStreamsOptions
): Promise<number> {
  const outstanding = new Set(activityIds);
  if (outstanding.size === 0 || signal?.aborted) {
    return Promise.resolve(outstanding.size);
  }

  return awaitEngineAnnouncement<number>({
    channel: STORED_CHANNEL,
    timeoutMs,
    signal,
    onDeadline: () => outstanding.size,
    subscribe: (channel, listener) => engine.subscribe(channel, listener),
    read: (payload) => {
      const stored = (payload as { activityIds?: string[] } | undefined)?.activityIds;
      if (!stored) return undefined;
      const before = outstanding.size;
      stored.forEach((id) => outstanding.delete(id));
      if (outstanding.size === before) return undefined;
      onProgress?.(outstanding.size);
      return outstanding.size === 0 ? 0 : undefined;
    },
  });
}
