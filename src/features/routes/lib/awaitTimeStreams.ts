/**
 * Waits for the `time` streams a batch of activities is missing.
 *
 * Rust announces each stream as it lands and the announcement names the
 * activity, so the wait reads nothing from the engine: what is still
 * outstanding is tracked here. A stream the server does not hold never lands,
 * which is what the timeout is for.
 */

import { engine } from 'veloqrs';

import { awaitEngineAnnouncement } from '@/shared/native/awaitEngineAnnouncement';

/** The channel `EngineObserver.time_streams_stored` lands on. */
const STORED_CHANNEL = 'timeStreamsStored';

export interface AwaitTimeStreamsOptions {
  /** Give up after this long, whatever is still outstanding. */
  timeoutMs: number;
  /** Ends the wait early, for a caller that has gone away. */
  signal?: AbortSignal;
  /** How many are still outstanding, called as each announcement lands. */
  onProgress?: (remaining: number) => void;
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
