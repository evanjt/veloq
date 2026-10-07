/**
 * What the athlete is told when a GPS download gives up.
 *
 * The tracks are fetched outside the engine's sync service, so a run that ends
 * with activities still missing their track leaves sync health clean and every
 * banner silent. The only record was a `console.warn`, which the production
 * Babel config strips, so in a release build the failure had no signal at all:
 * the routes are simply absent from the map and matched against no section.
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
import { getSetting, removeSetting, setSetting } from '@/shared/storage';

/** Where the dismissed set is kept, as its key. */
export const DISMISSED_KEY = 'veloq-track-fetch-dismissed';

/** Enough of a fetch run's result to decide what to say about it. */
export interface TrackFetchRun {
  failedIds: string[];
}

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
  /** Tracks the last finished run could not download, empty when it landed them all. */
  failedIds: string[];
  /** `failedIds.length`, kept for the line that shows it. */
  failedCount: number;
  /** Whether the athlete has closed the notice for this set. */
  dismissed: boolean;
  /** The set the athlete last closed, as its key, or null when none. */
  dismissedKey: string | null;
  /** Record what a finished run left behind. */
  report: (failedIds: readonly string[]) => void;
  dismiss: () => void;
}

export const useTrackFetchNotice = create<TrackFetchNoticeState>((set, get) => ({
  failedIds: [],
  failedCount: 0,
  dismissed: false,
  dismissedKey: null,
  report: (failedIds) => {
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

/** Report a finished run, from outside React. */
export function reportTrackFetchRun(run: TrackFetchRun | null): void {
  useTrackFetchNotice.getState().report(run?.failedIds ?? []);
}

/**
 * Read the persisted dismissal, and apply it to whatever has been reported
 * so far. Launch runs it beside the other stores; a run that reports before
 * it resolves is re-judged here rather than shown for a set already closed.
 */
export async function loadTrackFetchNotice(): Promise<void> {
  let key: string | null = null;
  try {
    key = await getSetting(DISMISSED_KEY);
  } catch {
    key = null;
  }
  const { failedIds } = useTrackFetchNotice.getState();
  useTrackFetchNotice.setState({
    dismissedKey: key,
    dismissed: isDismissed(failedIds, key),
  });
}

/**
 * Forget the dismissed set, which names the athlete's activities, so the wipe
 * leaves no dismissal behind for the next library to inherit.
 */
export async function forgetTrackFetchDismissal(): Promise<void> {
  useTrackFetchNotice.setState({ dismissedKey: null, dismissed: false });
  await removeSetting(DISMISSED_KEY).catch(() => {});
}
