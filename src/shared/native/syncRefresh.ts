/**
 * Ask the engine for a fresh sync as part of a pull-to-refresh.
 *
 * Invalidating a query whose `queryFn` reads SQLite only re-runs the read, so
 * on its own the gesture redraws what the last sync wrote and never reaches
 * intervals.icu.
 *
 * `syncNow()` refuses while a sync holds the exclusive slot, and every caller
 * discards the answer, so the pull used to resolve over unchanged data with
 * nothing queued behind it. A refused pull is now held and run when the slot
 * frees. One is held however many times the athlete pulls: they asked for
 * current data, not for a sync each. The verdict says which refusal it was, so
 * only the kind that lifts is held. A missing credential is not waited on.
 */
import { hasStarted, isRetryableStart, StartOutcome } from 'veloqrs';

import { getEngine } from './engine';

let waiting: (() => void) | null = null;

export function requestSyncRefresh(): StartOutcome {
  const engine = getEngine();
  if (!engine) return StartOutcome.NotReady;

  const outcome = engine.syncNow();
  if (hasStarted(outcome) || !isRetryableStart(outcome)) return outcome;

  // `syncSettled` is the terminal transition, so each retry costs one sync
  // ending. A slot taken again in between waits for the next one rather than
  // spinning.
  waiting ??= engine.subscribe('syncSettled', () => {
    waiting?.();
    waiting = null;
    requestSyncRefresh();
  });
  return outcome;
}
