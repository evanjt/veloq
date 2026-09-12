/**
 * The map surface's in-flight requests, and what happens to them when the page
 * that would answer goes away.
 *
 * A query, a cluster expansion or a projection is a promise the page resolves
 * over the bridge. Unmounting, releasing the surface or a renderer crash all
 * leave the page unable to answer, and dropping the resolver leaves the
 * awaiting closure alive for the life of the process. So each caller names the
 * answer it wants in that case and `abandon` hands it over.
 */

type Waiting = {
  resolve: (value: unknown) => void;
  empty: unknown;
};

export function createPendingRequests() {
  const waiting = new Map<string, Waiting>();
  let seq = 0;

  return {
    size: () => waiting.size,

    /** Issue a request id, hand it to `send`, and wait for the page. */
    open<T>(empty: T, send: (requestId: string) => void): Promise<T> {
      seq += 1;
      const requestId = `req_${seq}`;
      return new Promise<T>((resolve) => {
        waiting.set(requestId, { resolve: resolve as (value: unknown) => void, empty });
        send(requestId);
      });
    },

    /** The page answered. An id already settled or never issued is ignored. */
    settle(requestId: string, value: unknown) {
      const entry = waiting.get(requestId);
      if (!entry) return;
      waiting.delete(requestId);
      entry.resolve(value);
    },

    /** The page is gone. Everyone waiting gets the empty answer they named. */
    abandon() {
      const entries = [...waiting.values()];
      waiting.clear();
      for (const entry of entries) entry.resolve(entry.empty);
    },
  };
}
