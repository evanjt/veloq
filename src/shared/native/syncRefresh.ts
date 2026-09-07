/**
 * Ask the engine for a fresh sync as part of a pull-to-refresh.
 *
 * Invalidating a query whose `queryFn` reads SQLite only re-runs the read, so
 * on its own the gesture redraws what the last sync wrote and never reaches
 * intervals.icu. The verdict says whether the sync started and, when it did
 * not, whether asking again later would: a held slot frees within minutes,
 * while a missing credential never does.
 */
import { StartOutcome } from 'veloqrs';

import { getEngine } from './engine';

export function requestSyncRefresh(): StartOutcome {
  return getEngine()?.syncNow() ?? StartOutcome.NotReady;
}
