/**
 * The map surface's in-flight requests, and what happens to them when the page
 * that would answer goes away.
 *
 * A query, a cluster expansion or a projection is a promise the page resolves
 * over the bridge. Unmounting, releasing the surface or a renderer crash all
 * leave the page unable to answer, and dropping the resolver leaves the
 * awaiting closure alive for the life of the process. So each caller names the
 * answer it wants in that case and `abandon` hands it over. A page that is
 * alive but never answers, a script that threw or an API that never called
 * back, gets the same empty answer once the deadline passes.
 */

/** How long a request waits for the page before it settles empty, in ms. */
export const PENDING_REQUEST_DEADLINE_MS = 2000;

type Waiting = {
  resolve: (value: unknown) => void;
  empty: unknown;
  timer: ReturnType<typeof setTimeout>;
};

export function createPendingRequests(deadlineMs: number = PENDING_REQUEST_DEADLINE_MS) {
  const waiting = new Map<string, Waiting>();
  let seq = 0;

  return {
    size: () => waiting.size,

    /** Issue a request id, hand it to `send`, and wait for the page. */
    open<T>(empty: T, send: (requestId: string) => void): Promise<T> {
      seq += 1;
      const requestId = `req_${seq}`;
      return new Promise<T>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          resolve(empty);
        }, deadlineMs);
        waiting.set(requestId, { resolve: resolve as (value: unknown) => void, empty, timer });
        send(requestId);
      });
    },

    /** The page answered. An id already settled or never issued is ignored. */
    settle(requestId: string, value: unknown) {
      const entry = waiting.get(requestId);
      if (!entry) return;
      waiting.delete(requestId);
      clearTimeout(entry.timer);
      entry.resolve(value);
    },

    /** The page is gone. Everyone waiting gets the empty answer they named. */
    abandon() {
      const entries = [...waiting.values()];
      waiting.clear();
      for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.resolve(entry.empty);
      }
    },
  };
}
