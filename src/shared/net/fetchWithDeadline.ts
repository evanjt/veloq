/**
 * A deadline on the requests that never reach Rust.
 *
 * Every intervals.icu request goes through the engine, where the lanes are
 * bounded (`net/transport.rs`). The OAuth proxy, the push device token and the
 * WebDAV metadata calls stay in TypeScript, where a plain fetch waits on the
 * platform socket timeout: minutes on Android, and longer on a connection that
 * accepts the handshake and then answers nothing. Sign-in on a train spun with
 * no cancel.
 *
 * The ceilings are the engine's own, so there is one family of numbers rather
 * than a second set invented here.
 */

/** The ceilings, in milliseconds, keyed by what the request is for. */
export const NET_DEADLINE_MS = {
  /** A person is watching: sign-in, a token refresh, a connection test. */
  interactive: 10_000,
  /** A body of some size moves: the backfill lane's per-attempt ceiling. */
  transfer: 30_000,
} as const;

/** A request abandoned at its ceiling, which is not a verdict from the server. */
export class FetchTimeoutError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`Request timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'FetchTimeoutError';
    this.ms = ms;
  }
}

export function isFetchTimeout(error: unknown): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}

/** What actually sends the request. `fetch` in the app, a stub in tests. */
type Send = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * `fetch`, abandoned at `ms` with a `FetchTimeoutError`.
 *
 * Built on `AbortController` rather than `AbortSignal.timeout`, which not every
 * Hermes build carries, and the timer is cleared on every path so a resolved
 * request leaves nothing pending. A signal the caller passes still aborts the
 * request, and that abort is theirs rather than a timeout.
 */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit = {},
  ms: number = NET_DEADLINE_MS.interactive,
  send: Send = fetch
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortForCaller = () => controller.abort();
  callerSignal?.addEventListener('abort', abortForCaller);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  try {
    return await send(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw timedOut ? new FetchTimeoutError(ms) : error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortForCaller);
  }
}
