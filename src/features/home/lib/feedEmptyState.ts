import { SyncState } from 'veloqrs';

/** What the feed draws in place of cards, or `none` when it has cards. */
export type FeedEmptyState = 'none' | 'error' | 'standby' | 'skeletons' | 'empty';

interface FeedEmptyInput {
  /** Activities the feed is holding, after any filter. */
  storedCount: number;
  /** The engine's own sync state, or undefined before the first read. */
  syncState: SyncState | undefined;
  isError: boolean;
  /** Whether the activities query has yet to answer. */
  isLoading: boolean;
  /** Whether a search or a sport filter is narrowing the feed. */
  hasFilter: boolean;
}

/**
 * What an empty feed says.
 *
 * A first launch used to land on "No activities" over a summary card of zeros,
 * because the query resolves empty long before the first sync has stored
 * anything and `isLoading` is false by then. So the empty library plus a
 * running sync is its own case, and it is the one a first launch is in.
 *
 * The filter is what separates "nothing has arrived yet" from "nothing matches
 * what you asked for": a narrowed feed with no results is the athlete's own
 * doing and a sync has nothing to say about it.
 */
export function feedEmptyState({
  storedCount,
  syncState,
  isError,
  isLoading,
  hasFilter,
}: FeedEmptyInput): FeedEmptyState {
  if (isError) return 'error';
  if (storedCount > 0) return 'none';
  if (!hasFilter && syncState === SyncState.Syncing) return 'standby';
  if (isLoading) return 'skeletons';
  return 'empty';
}
