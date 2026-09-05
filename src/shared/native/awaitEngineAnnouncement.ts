/**
 * Wait for an engine announcement that concerns a particular thing.
 *
 * Rust announces work as it lands and the payload names what landed, so a
 * caller that needs one result subscribes rather than polls. The shape is the
 * same every time: subscribe, filter the payload, resolve on a match, fall
 * back to a deadline, and unsubscribe on every exit including the deadline and
 * an abort. This is that shape, once.
 *
 * The subscription is passed in rather than taken from a module: the two
 * callers reach the engine differently, and neither `routes` nor `maps` owns
 * the idea.
 */

export interface AwaitAnnouncementOptions<T> {
  /** The engine channel to listen on. */
  channel: string;
  /** Give up after this long. */
  timeoutMs: number;
  /**
   * What one announcement means. Return a value to settle with, or undefined
   * to keep waiting. Side effects belong here: it runs once per announcement.
   */
  read: (payload?: unknown) => T | undefined;
  /** What to settle with when the deadline passes or the caller aborts. */
  onDeadline: () => T;
  /** Subscribes and returns its own unsubscribe. */
  subscribe: (channel: string, listener: (payload?: unknown) => void) => (() => void) | undefined;
  /** Ends the wait early, for a caller that has gone away. */
  signal?: AbortSignal;
}

export function awaitEngineAnnouncement<T>({
  channel,
  timeoutMs,
  read,
  onDeadline,
  subscribe,
  signal,
}: AwaitAnnouncementOptions<T>): Promise<T> {
  if (signal?.aborted) return Promise.resolve(onDeadline());

  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = undefined;
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => settle(onDeadline());

    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort);

    unsubscribe = subscribe(channel, (payload) => {
      const value = read(payload);
      if (value !== undefined) settle(value);
    });
  });
}
