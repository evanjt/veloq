/**
 * What the athlete is told when the engine gives up on a GPS download.
 *
 * The engine decides when a track is given up on, after its own retries, and
 * keeps the list. This store only holds the last read of that list, so a run
 * that merely leaves tracks for the next pass never raises the notice: a track
 * the engine will still fetch is catch-up, shown as progress elsewhere.
 *
 * The count is held here rather than raised as a system notification, which is
 * the shape the decision asked for: an in-app line in front of the athlete.
 *
 * A dismissal belongs to the set of activities it was shown for, and it is
 * persisted: the same set, or any part of it, failing again after a relaunch
 * stays closed, and only an id outside it is news. Held in memory it came back on every launch for one
 * walk whose track could never download.
 */

import { create } from 'zustand';
import { activities } from 'veloqrs';
import { getSetting, removeSetting, setSetting } from '@/shared/storage';

/** Where the dismissed set is kept, as its key. */
export const DISMISSED_KEY = 'veloq-track-fetch-dismissed';

/** One key per set of activities, whatever order the run listed them in. */
export function failureKey(failedIds: readonly string[]): string {
  return [...failedIds].sort().join(',');
}

/** Whether every failing id was in the set the athlete closed, so only a new id is news. */
export function isDismissed(failedIds: readonly string[], dismissedKey: string | null): boolean {
  if (failedIds.length === 0 || dismissedKey === null) return false;
  const closed = new Set(dismissedKey.split(','));
  return failedIds.every((id) => closed.has(id));
}

interface TrackFetchNoticeState {
  /** Tracks the engine has given up on, empty when it holds none. */
  failedIds: string[];
  /** `failedIds.length`, kept for the line that shows it. */
  failedCount: number;
  /** Whether the athlete has closed the notice for this set. */
  dismissed: boolean;
  /** The set the athlete last closed, as its key, or null when none. */
  dismissedKey: string | null;
  /** Replace the held list with the engine's current one. */
  setGivenUp: (failedIds: readonly string[]) => void;
  dismiss: () => void;
}

export const useTrackFetchNotice = create<TrackFetchNoticeState>((set, get) => ({
  failedIds: [],
  failedCount: 0,
  dismissed: false,
  dismissedKey: null,
  setGivenUp: (failedIds) => {
    const ids = [...failedIds];
    set({
      failedIds: ids,
      failedCount: ids.length,
      dismissed: isDismissed(ids, get().dismissedKey),
    });
  },
  dismiss: () => {
    const key = failureKey(get().failedIds);
    set({ dismissed: true, dismissedKey: key });
    setSetting(DISMISSED_KEY, key).catch(() => {});
  },
}));

/**
 * Read the engine's given-up list into the store. A closed engine answers
 * nothing, which leaves the list as it was rather than clearing it.
 */
export function refreshTrackFetchNotice(): void {
  let given;
  try {
    given = activities.getGivenUpTracks();
  } catch {
    return;
  }
  useTrackFetchNotice.getState().setGivenUp(given.tracks.map((t) => t.activityId));
}

/**
 * Read the persisted dismissal and the engine's given-up list. Launch runs it
 * beside the other stores; a list read before the dismissal resolves is
 * re-judged here rather than shown for a set already closed.
 */
export async function loadTrackFetchNotice(): Promise<void> {
  let key: string | null = null;
  try {
    key = await getSetting(DISMISSED_KEY);
  } catch {
    key = null;
  }
  useTrackFetchNotice.setState({ dismissedKey: key });
  refreshTrackFetchNotice();
  const { failedIds } = useTrackFetchNotice.getState();
  useTrackFetchNotice.setState({ dismissed: isDismissed(failedIds, key) });
}

/**
 * Forget the dismissed set, which names the athlete's activities, so the wipe
 * leaves no dismissal behind for the next library to inherit.
 */
export async function forgetTrackFetchDismissal(): Promise<void> {
  useTrackFetchNotice.setState({ dismissedKey: null, dismissed: false });
  await removeSetting(DISMISSED_KEY).catch(() => {});
}
