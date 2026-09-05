/**
 * Read a body the Rust sync stores on demand, asking for it when it is absent.
 *
 * Curves, activity intervals and calendar events are per-parameter fetches, so
 * the launch sync cannot prefetch them. The read returns what is stored;
 * `null` means "never fetched", which is the cue to request it. Rust folds
 * duplicate requests together, and announces the landing on `bodyStored`,
 * which wakes the query that asked. Nothing is read on a timer: between the
 * request and the event this costs no engine call at all.
 *
 * One window that announcement cannot cover: a body that lands after the
 * request goes out and before the subscription is registered is announced to
 * nobody, and the query would then wait for an event that has already
 * happened. Rust keeps a count of stored bodies for exactly this, and the two
 * reads below, one either side of the request, are what close it.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getEngine } from './engine';

/**
 * What announces a body. `bodyStored` is the on-demand landing, `activities`
 * the coarse channel a full sync fans out on.
 */
const CHANNELS = ['bodyStored', 'activities'] as const;

/**
 * The stored-body count, or null when the engine cannot answer. Null disables
 * the reconciliation for that mount, which costs a query that waits for the
 * next announcement. Never let it cost the fetch itself.
 */
function bodiesStored(): number | null {
  try {
    return getEngine()?.getBodiesStored?.() ?? null;
  } catch {
    return null;
  }
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

  // The count as the request went out, or null when this mount asked for
  // nothing and so has no window to reconcile.
  const countAtRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || present) return;
    countAtRequest.current = bodiesStored();
    request();
    // `request` closes over the parameters already encoded in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, present, keyId]);

  useEffect(() => {
    if (!enabled) return;
    const engine = getEngine();
    if (!engine) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey });
    const unsubscribes = CHANNELS.map((channel) => engine.subscribe(channel, invalidate));

    // Now that something is listening, ask whether the landing already
    // happened. A moved count is a body stored while nobody was, and it is the
    // only trace of it. Read once, never on a timer.
    const asked = countAtRequest.current;
    countAtRequest.current = null;
    if (asked !== null) {
      const now = bodiesStored();
      if (now !== null && now !== asked) invalidate();
    }

    return () => unsubscribes.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryClient, keyId]);
}
