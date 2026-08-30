/**
 * Read a body the Rust sync stores on demand, asking for it when it is absent.
 *
 * Curves, activity intervals and calendar events are per-parameter fetches, so
 * the launch sync cannot prefetch them. The read returns what is stored;
 * `null` means "never fetched", which is the cue to request it. Rust folds
 * duplicate requests together, and the engine event wakes the query when the
 * body lands.
 *
 * That event has to be made. The fetch settles on a Rust thread with no way to
 * reach the TypeScript listener map, so while a reader is waiting the count of
 * landed bodies is polled, and a count that moves fans a change out over the
 * `activities` channel. One timer is shared across every waiting reader and it
 * runs only while at least one is waiting, so an app with every body already
 * stored polls nothing. A caller that passes `present` as a constant false
 * keeps it armed for as long as its screen is open, which is what the read
 * costs: one atomic load across the bridge.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getRouteEngine } from './routeEngine';

/**
 * How often a waiting reader checks whether a body landed. Short enough that a
 * chart on wifi fills in without a visible pause, long enough that the FFI read
 * costs nothing against a fetch measured in hundreds of milliseconds.
 */
const POLL_MS = 500;

let waiting = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastCount = 0;

/**
 * Count this caller as waiting on a body and start the shared poll if it is the
 * first. Returns the release, so the timer stops with the last waiter.
 */
function watchForLandings(): () => void {
  if (waiting === 0) {
    lastCount = getRouteEngine()?.getBodiesStored() ?? 0;
    timer = setInterval(() => {
      const engine = getRouteEngine();
      if (!engine) return;
      const count = engine.getBodiesStored();
      if (count === lastCount) return;
      lastCount = count;
      engine.triggerRefresh('activities');
    }, POLL_MS);
  }
  waiting += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    waiting -= 1;
    if (waiting === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Request `resource` once per mount-with-these-parameters when `present` is
 * false, and invalidate `queryKey` when the engine reports a change.
 */
export function useEngineBody(
  present: boolean,
  request: () => void,
  queryKey: QueryKey,
  enabled = true
): void {
  const queryClient = useQueryClient();
  const keyId = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || present) return;
    request();
    return watchForLandings();
    // `request` closes over the parameters already encoded in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, present, keyId]);

  useEffect(() => {
    if (!enabled) return;
    const engine = getRouteEngine();
    if (!engine) return;
    return engine.subscribe('activities', () => {
      queryClient.invalidateQueries({ queryKey });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryClient, keyId]);
}
