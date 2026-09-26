/**
 * How many heatmap tile passes have finished this session.
 *
 * A tile the pass had not reached is answered 404 by the interceptor, and
 * MapLibre scales the parent tile up and never asks again: the same URL cannot
 * change its mind. So a viewport opened while the pass is below its zoom keeps
 * the low-resolution picture until a gesture asks for different tiles.
 *
 * Rust announces the end of a pass on `tilesGenerated`, which is what
 * `awaitTilePass` already listens to. Counting those announcements gives the
 * source a version to carry, and a changed tile URL is a source MapLibre
 * fetches again. The interceptor reads the path and ignores the query on both
 * platforms, so the version costs nothing.
 */

import { useSyncExternalStore } from 'react';

import { engine } from 'veloqrs';

/** The channel `EngineObserver.tiles_generated` lands on. */
const GENERATED_CHANNEL = 'tilesGenerated';

let generation = 0;
let unsubscribe: (() => void) | undefined;
const listeners = new Set<() => void>();

function announced(): void {
  generation += 1;
  listeners.forEach((listener) => listener());
}

/** How many passes have finished. Zero until one does. */
export function heatmapGeneration(): number {
  return generation;
}

/**
 * Hear about the next pass. One engine subscription serves every listener,
 * because the map has two surfaces and both want the same count.
 */
export function subscribeHeatmapGeneration(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribe) {
    try {
      unsubscribe = engine.subscribe(GENERATED_CHANNEL, announced);
    } catch {
      // No engine yet, which is the web and the first frames of a launch. The
      // next subscriber attaches instead.
      unsubscribe = undefined;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };
}

/**
 * The count, for a component that should redraw when it moves.
 *
 * `useSyncExternalStore` rather than state and an effect: the surfaces mount
 * and unmount with the tab, and the subscription is shared, so there is one
 * engine listener however many of them are up.
 */
export function useHeatmapGeneration(): number {
  return useSyncExternalStore(subscribeHeatmapGeneration, heatmapGeneration, heatmapGeneration);
}

/**
 * Tell the engine which ground the map is showing.
 *
 * Here rather than in the view, because this module is already the one file in
 * the maps feature that speaks to the engine about the heatmap, and the
 * engine-surface ratchet counts files that reach it directly. `center` is
 * MapLibre's order, longitude then latitude.
 */
export function reportHeatmapView(center: [number, number], zoom: number): void {
  try {
    engine.setHeatmapPriorityView(center[1], center[0], Math.round(zoom));
  } catch {
    // No engine yet, or a build without the module: the pass keeps the order
    // it had, which is what it did before this existed.
  }
}
