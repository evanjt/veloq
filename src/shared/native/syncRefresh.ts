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
 * current data, not for a sync each.
 */
import { getEngine } from './engine';

let waiting: (() => void) | null = null;

/** Returns false when no engine is open, or when the refresh was deferred. */
export function requestSyncRefresh(): boolean {
  const engine = getEngine();
  if (!engine) return false;
  if (engine.syncNow()) return true;

  // `syncSettled` is the terminal transition, so each retry costs one sync
  // ending. A slot taken again in between waits for the next one rather than
  // spinning.
  waiting ??= engine.subscribe('syncSettled', () => {
    waiting?.();
    waiting = null;
    requestSyncRefresh();
  });
  return false;
}
