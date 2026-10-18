/**
 * Whether a screen on view carries the sync's progress itself, so the floating
 * sync pill steps aside rather than counting the same steps a second time.
 *
 * A screen raises it while its own progress view is in front and lowers it when
 * that view goes or the screen loses focus, so the pill comes back for the rest
 * of the sync and on every other route. Only the pill reads it; error banners
 * do not, since a failure must still show.
 */

import { useEffect, useSyncExternalStore } from 'react';

let raised = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readYielded(): boolean {
  return raised > 0;
}

/** Ask the sync pill to step aside while `active` holds. */
export function useSyncPillYield(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    raised += 1;
    notify();
    return () => {
      raised -= 1;
      notify();
    };
  }, [active]);
}

/** Whether a screen in front carries the sync's progress itself. */
export function useSyncPillYielded(): boolean {
  return useSyncExternalStore(subscribe, readYielded, readYielded);
}
