import { SyncErrorReason, SyncState } from 'veloqrs';

import type { EngineReadState } from '@/shared/native/useEngineSubscription';

/** What the feed draws in place of cards, or `none` when it has cards. */
export type FeedEmptyState =
  | 'none'
  | 'error'
  | 'engineUnavailable'
  | 'standby'
  | 'skeletons'
  | 'paused'
  | 'authExpired'
  | 'failed'
  | 'empty';

interface FeedEmptyInput {
  /** Activities the feed is holding, after any filter. */
  storedCount: number;
  /** The engine's own sync state, or undefined before the first read. */
  syncState: SyncState | undefined;
  /** Why the engine's last sync failed, or null when it settled clean. */
  lastErrorReason: SyncErrorReason | null;
  isError: boolean;
  /** Whether the activities query has yet to answer. */
  isLoading: boolean;
  /** Whether a search, a sport chip or a date range is narrowing the feed. */
  hasFilter: boolean;
  /** Whether the engine the rows came from is open, still opening, or gave up. */
  engine: EngineReadState;
}

/**
 * What an empty feed says.
 *
 * A first launch used to land on "No activities" over a summary card of zeros,
 * because the query resolves empty long before the first sync has stored
 * anything and `isLoading` is false by then. So the empty library plus a
 * running sync is its own case, and it is the one a first launch is in.
 *
 * A first sync that stopped short is not an empty account either: the
 * activities are on intervals.icu and the sync did not bring them. A pause, a
 * refused login and a failure each say so, read from the engine's state and
 * its classified reason, and only a sync that settled clean over nothing
 * leaves the library empty.
 *
 * The filter is what separates "nothing has arrived yet" from "nothing matches
 * what you asked for": a narrowed feed with no results is the athlete's own
 * doing and a sync has nothing to say about it.
 *
 * Neither holds while the engine is not open, because its rows are then its
 * empty default and not the library. One still opening keeps the skeletons,
 * and one that gave up says so, filtered or not, since a search reads the
 * same engine.
 */
export function feedEmptyState({
  storedCount,
  syncState,
  lastErrorReason,
  isError,
  isLoading,
  hasFilter,
  engine,
}: FeedEmptyInput): FeedEmptyState {
  if (isError) return 'error';
  if (storedCount > 0) return 'none';
  if (engine === 'failed') return 'engineUnavailable';
  if (engine === 'closed') return 'skeletons';
  if (!hasFilter && syncState === SyncState.Syncing) return 'standby';
  if (isLoading) return 'skeletons';
  if (hasFilter) return 'empty';
  if (syncState === SyncState.AuthExpired || lastErrorReason === SyncErrorReason.Unauthorized) {
    return 'authExpired';
  }
  if (syncState === SyncState.Paused || lastErrorReason === SyncErrorReason.RateLimited) {
    return 'paused';
  }
  if (lastErrorReason !== null) return 'failed';
  return 'empty';
}
