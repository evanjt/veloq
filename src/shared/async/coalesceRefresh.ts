/**
 * One rebuild per burst, not one per event.
 *
 * `activities` fires from seven places and two of them are inside a per-batch
 * loop, so a GPS backfill announces it repeatedly. Every announcement made the
 * map page re-read the whole `signatures` table, decode each blob in Rust,
 * re-encode it for the bridge and decode it again in JS, then invalidate the
 * marker centres, all three GeoJSON builders and the camera fit.
 *
 * Leading edge plus trailing edge: the first event runs at once, so the map
 * still moves as soon as something lands. Anything else inside the window sets
 * a flag and the window's close spends it on one more run. A burst of any
 * length therefore costs two rebuilds rather than N.
 */

/** Undoes a scheduled call. */
export type Cancel = () => void;

/** What schedules the trailing run. `setTimeout` in the app, a stub in tests. */
export type Schedule = (fn: () => void, ms: number) => Cancel;

export interface Coalescer {
  /** Record an event, running now or on the window's close. */
  request: () => void;
  /** Forget any pending run. Safe to call when nothing is pending. */
  cancel: () => void;
  /** Whether a trailing run is owed. For assertions, not for logic. */
  isPending: () => boolean;
}

export function createCoalescer(run: () => void, windowMs: number, schedule: Schedule): Coalescer {
  let closeWindow: Cancel | null = null;
  let owed = false;

  const openWindow = () => {
    closeWindow = schedule(() => {
      closeWindow = null;
      if (!owed) return;
      owed = false;
      // The trailing run is itself a leading edge: a burst that has not stopped
      // must not be answered twice in the same window.
      openWindow();
      run();
    }, windowMs);
  };

  return {
    request: () => {
      if (closeWindow) {
        owed = true;
        return;
      }
      openWindow();
      run();
    },
    cancel: () => {
      closeWindow?.();
      closeWindow = null;
      owed = false;
    },
    isPending: () => owed,
  };
}
