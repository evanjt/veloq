/**
 * What a route sync pass may do, given the network and the mode it runs in.
 *
 * The pass has two halves. One reaches intervals.icu: the GPS fetch, the FIT
 * batch for strength activities, the time-stream backfill. The other is local
 * compute over tracks already in SQLite: seeding activity metrics, draining a
 * detection result nobody collected, and re-running a detection the engine
 * marked dirty. Offline, only the first half has nothing to do, and blocking
 * both left an athlete whose app was killed mid-detection with no sections and
 * no way back until the network returned.
 */

export interface RouteSyncConditions {
  /** The network as the sync context last saw it. */
  online: boolean;
  /** Demo mode reads its GPS from fixtures, so it needs no network. */
  isDemo: boolean;
  /** Activities with GPS the engine has not seen yet. */
  newGpsCount: number;
}

export interface RouteSyncPlan {
  /** Fetch GPS for the activities the engine is missing. */
  fetchGps: boolean;
  /** Ask Rust to pull FIT files for unprocessed strength activities. */
  fetchStrength: boolean;
  /** Backfill time streams for activities with a NULL lap_time. */
  backfillStreams: boolean;
  /** Drain a finished detection and restart a dirty one. */
  recoverDetection: boolean;
}

export function routeSyncPlan({ online, isDemo, newGpsCount }: RouteSyncConditions): RouteSyncPlan {
  // Demo fixtures are on disk, so demo mode fetches GPS offline and asks the
  // network for nothing else.
  const canFetchGps = online || isDemo;
  return {
    fetchGps: canFetchGps && newGpsCount > 0,
    fetchStrength: online && !isDemo,
    backfillStreams: online && !isDemo,
    // The recovery is the local half, and it runs whenever the pass is not
    // going on to fetch.
    recoverDetection: !(canFetchGps && newGpsCount > 0),
  };
}
