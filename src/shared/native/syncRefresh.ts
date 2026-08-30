/**
 * Ask the engine for a fresh sync as part of a pull-to-refresh.
 *
 * Invalidating a query whose `queryFn` reads SQLite only re-runs the read, so
 * on its own the gesture redraws what the last sync wrote and never reaches
 * intervals.icu. Returns false when no engine is open or a sync already holds
 * the slot, which is not an error worth surfacing.
 */
import { getRouteEngine } from './routeEngine';

export function requestSyncRefresh(): boolean {
  return getRouteEngine()?.syncNow() ?? false;
}
