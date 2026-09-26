/**
 * Whether a widened local range is still being downloaded.
 *
 * The store used to answer this with TanStack's `isFetching` on the activities
 * query. That query reads SQLite, so it settles in milliseconds while the
 * download it was standing for runs for seconds, and every banner named after
 * the download cleared almost as soon as it appeared.
 *
 * The download is `sync_activities_window` holding the engine's exclusive sync
 * slot, so the truthful answer is that slot. A request the engine accepted but
 * never picked up gets a deadline and a name of its own rather than a banner
 * that stays up for the rest of the session.
 */

/**
 * `awaitingPickup` is the gap between the engine accepting a window and its
 * status reporting the slot held. `expired` is that gap running out, which is
 * a terminal state the banner stops on rather than "keep waiting".
 */
export type ExtendedFetchPhase = 'idle' | 'awaitingPickup' | 'downloading' | 'expired';

/** How long an accepted window waits for the engine to report the slot held. */
export const PICKUP_DEADLINE_MS = 30_000;

export interface ExtendedFetchState {
  phase: ExtendedFetchPhase;
  /** When the phase was entered, epoch milliseconds. */
  since: number;
}

export const IDLE_EXTENDED_FETCH: ExtendedFetchState = { phase: 'idle', since: 0 };

/** The engine accepted a window download. */
export function windowAccepted(state: ExtendedFetchState, now: number): ExtendedFetchState {
  // A second window accepted mid-download is the same download continuing, so
  // the phase stands and only the clock moves on.
  if (state.phase === 'downloading') return { phase: 'downloading', since: now };
  return { phase: 'awaitingPickup', since: now };
}

/** The engine's sync status changed. */
export function syncStateChanged(
  state: ExtendedFetchState,
  syncing: boolean,
  now: number
): ExtendedFetchState {
  if (syncing) {
    // A launch sync holds the same slot and is not an extended fetch, so the
    // slot only names one once a window has been accepted.
    if (state.phase === 'awaitingPickup') return { phase: 'downloading', since: now };
    return state;
  }
  if (state.phase === 'downloading') return { phase: 'idle', since: now };
  // Still awaiting pickup: the engine has not reported the slot yet, and the
  // deadline rather than this reading is what ends the wait.
  return state;
}

/** The pickup deadline running out, which only `awaitingPickup` can reach. */
export function expirePickup(state: ExtendedFetchState, now: number): ExtendedFetchState {
  if (state.phase !== 'awaitingPickup') return state;
  if (now - state.since < PICKUP_DEADLINE_MS) return state;
  return { phase: 'expired', since: now };
}

/** Whether a surface should say a widened range is still coming in. */
export function isExtendedFetchRunning(state: ExtendedFetchState): boolean {
  return state.phase === 'awaitingPickup' || state.phase === 'downloading';
}
