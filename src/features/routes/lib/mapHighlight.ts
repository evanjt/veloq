import { useSyncExternalStore } from 'react';
import type { RoutePoint } from '@/types';

/**
 * What the hero map draws for a chart scrub: one attempt, the lap's own trace
 * if it has one, and the attempt's date, which the map key names it by.
 */
export interface MapHighlight {
  activityId: string | null;
  lapPoints: RoutePoint[] | undefined;
  date: Date | undefined;
}

export interface MapHighlightStore {
  /** Bound to the store, so it can be handed to a chart as a stable callback. */
  set: (activityId: string | null, lapPoints?: RoutePoint[], date?: Date) => void;
  get: () => MapHighlight;
  subscribe: (listener: () => void) => () => void;
}

const NOTHING: MapHighlight = { activityId: null, lapPoints: undefined, date: undefined };

/**
 * Holds the scrubbed attempt outside the screen that owns the chart, so a new
 * index re-renders the readers that draw it and not the screen root. The
 * screen creates one and never reads it.
 */
export function createMapHighlightStore(): MapHighlightStore {
  let current = NOTHING;
  const listeners = new Set<() => void>();

  return {
    set(activityId, lapPoints, date) {
      if (
        current.activityId === activityId &&
        current.lapPoints === lapPoints &&
        current.date?.getTime() === date?.getTime()
      )
        return;
      current =
        activityId === null && lapPoints === undefined ? NOTHING : { activityId, lapPoints, date };
      for (const listener of [...listeners]) listener();
    },
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store's value, for the component that draws it. */
export function useMapHighlight(store: MapHighlightStore): MapHighlight {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
