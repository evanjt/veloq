/**
 * Read a body the Rust sync stores on demand, asking for it when it is absent.
 *
 * Curves and activity intervals are per-parameter fetches, so the launch sync
 * cannot prefetch them. The read returns what is stored;
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
 * The other is a request Rust refused outright. `request` hands back the
 * engine's start verdict. One that asking again cannot change, such as no
 * credentials, ends the wait at once as `refused`. One that can change, a
 * request folded into one in flight or no network yet, keeps waiting, and so
 * does no verdict at all (demo mode, no engine). A refusal is announced by
 * nothing, so the deadline still ends a wait the verdict could not classify.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { useReconnect } from '@/shared/app/useRetryTriggers';

import { hasStarted, isRetryableStart, type StartOutcome, type StartResult } from 'veloqrs';

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
 * Whether a body is still being waited on. `refused` means the engine will
 * not fetch it and asking again cannot change that, so the screen can say so
 * at once. `timedOut` is not an error: the
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
export type EngineBodyStatus = 'idle' | 'waiting' | 'timedOut' | 'refused';

/**
 * The wait, and the way to start it over.
 *
 * `retry` asks again from the beginning: the request goes out a second time
 * and the deadline restarts. It is for a caller showing the athlete that the
 * fetch did not arrive. The hook calls it itself on the offline to online
 * edge, since a body asked for offline is not re-asked by anything else. A
 * `retry` while the wait is still running is a fresh request, which Rust folds
 * into the one in flight.
 */
export interface EngineBodyWait {
  status: EngineBodyStatus;
  retry: () => void;
}

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
  request: () => StartOutcome | StartResult | undefined,
  queryKey: QueryKey,
  enabled = true
): EngineBodyWait {
  const queryClient = useQueryClient();
  const keyId = JSON.stringify(queryKey);
  // Bumped by `retry`. It is part of the wait's identity below, so asking
  // again both re-runs the request and leaves the old expiry behind, with
  // nothing to reset.
  const [attempt, setAttempt] = useState(0);
  // The parameters and the attempt together, so one request is one wait. The
  // wait that ran out is held rather than a bare flag: a change of parameters,
  // or a retry, is a new wait, and it starts waiting again without anything
  // having to clear the old one.
  const waitId = `${keyId}#${attempt}`;
  const [expiredWait, setExpiredWait] = useState<string | null>(null);
  const [refusedWait, setRefusedWait] = useState<string | null>(null);

  // The count as the request went out, or null when this mount asked for
  // nothing and so has no window to reconcile.
  const countAtRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || present) return undefined;
    countAtRequest.current = bodiesStored();
    const outcome = request();
    if (outcome !== undefined && !hasStarted(outcome) && !isRetryableStart(outcome)) {
      // The verdict only exists once the request has gone out, so it is read here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefusedWait(waitId);
      return undefined;
    }

    // Nothing announces a refusal, so the wait ends on a clock or not at all.
    // The clock only ends the wait: it reads nothing and asks for nothing, so
    // the promise above, that this hook costs no engine call between the
    // request and the event, still holds.
    const timer = setTimeout(() => setExpiredWait(waitId), BODY_WAIT_MS);
    return () => clearTimeout(timer);
    // `request` closes over the parameters already encoded in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The request parameters are encoded in waitId.
  }, [enabled, present, waitId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyId identifies the subscription's query key.
  }, [enabled, queryClient, keyId]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A body missing on the edge was most likely asked for into a dead network,
  // and nothing in Rust re-asks an on-demand fetch.
  useReconnect(() => {
    if (enabled && !present) retry();
  });

  if (!enabled || present) return { status: 'idle', retry };
  if (refusedWait === waitId) return { status: 'refused', retry };
  return { status: expiredWait === waitId ? 'timedOut' : 'waiting', retry };
}
