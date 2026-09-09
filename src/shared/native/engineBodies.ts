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
 *
 * The other is a request Rust refused outright, which it does by returning a
 * bare `false` that means both "no credentials" and "folded into an identical
 * request already in flight". Opposite answers, same value, and the value is
 * erased at this boundary anyway. A refusal is announced by nothing, so a wait
 * on the announcement alone never ends and the screen spins until it is
 * closed. The deadline is what stops that. It does not make the refusal
 * legible, which is its own item; it makes the wait terminate regardless of
 * why the body never came.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getEngine } from './engine';

/**
 * What announces a body. `bodyStored` is the on-demand landing, `activities`
 * the coarse channel a full sync fans out on.
 */
const CHANNELS = ['bodyStored', 'activities'] as const;

/**
 * How long a body has to land before the wait is given up. The same budget
 * `awaitActivityBody` already spends, so a screen and the await it sits above
 * do not disagree about when a fetch has failed.
 */
export const BODY_WAIT_MS = 15_000;

/**
 * Whether a body is still being waited on. `timedOut` is not an error: the
 * body may still land and announce itself later, and the caller is free to
 * keep whatever it is showing. It means only that waiting is no longer a
 * reason to show a spinner.
 *
 * An announcement does not end the wait on its own, because an announcement on
 * the coarse channel may be about some other body. It invalidates the query,
 * the query re-reads, and `present` turning true is what ends it. So a landing
 * that is announced but does not actually store this body still reaches the
 * deadline.
 */
export type EngineBodyStatus = 'idle' | 'waiting' | 'timedOut';

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
): EngineBodyStatus {
  const queryClient = useQueryClient();
  const keyId = JSON.stringify(queryKey);
  // The key whose wait ran out, rather than a bare flag: a change of
  // parameters is a new request, and a new request starts waiting again
  // without anything having to reset the flag.
  const [expiredKey, setExpiredKey] = useState<string | null>(null);

  // The count as the request went out, or null when this mount asked for
  // nothing and so has no window to reconcile.
  const countAtRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || present) return undefined;
    countAtRequest.current = bodiesStored();
    request();

    // Nothing announces a refusal, so the wait ends on a clock or not at all.
    // The clock only ends the wait: it reads nothing and asks for nothing, so
    // the promise above, that this hook costs no engine call between the
    // request and the event, still holds.
    const timer = setTimeout(() => setExpiredKey(keyId), BODY_WAIT_MS);
    return () => clearTimeout(timer);
    // `request` closes over the parameters already encoded in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, present, keyId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const engine = getEngine();
    if (!engine) return undefined;
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

  if (!enabled || present) return 'idle';
  return expiredKey === keyId ? 'timedOut' : 'waiting';
}
