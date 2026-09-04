/**
 * Waits for the heatmap tile pass Rust runs in the background.
 *
 * The worker announces the pass when it finishes, so nothing is read while it
 * draws. The budget is a foreground cap, not a deadline: Rust keeps drawing
 * after it expires and the map picks the tiles up as they land.
 */

import { engine } from 'veloqrs';

/** The channel `EngineObserver.tiles_generated` lands on. */
const GENERATED_CHANNEL = 'tilesGenerated';

/** How long to hold the banner for a pass of `total` tiles. */
function budgetFor(total: number): number {
  return total > 0 ? Math.min(5_000, Math.max(2_000, total * 10)) : 3_000;
}

/**
 * Resolve when the running pass finishes or the budget expires. `onStarted`
 * is called once, with the pass this wait is for, and never when no pass is
 * running.
 */
export function awaitTilePass(
  onStarted?: (processed: number, total: number) => void
): Promise<void> {
  if (engine.pollTileGeneration() !== 'running') {
    return Promise.resolve();
  }

  const progress = engine.getHeatmapTileProgress();
  const [processed, total] = progress && progress.length >= 2 ? progress : [0, 0];
  onStarted?.(processed, total);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    let unsubscribe: (() => void) | undefined;

    const settle = (announced: boolean) => {
      clearTimeout(timer);
      unsubscribe?.();
      // One read to retire the finished handle, the way the old poll did. A
      // pass that outran the budget is still running and is left alone.
      if (announced) engine.pollTileGeneration();
      resolve();
    };

    timer = setTimeout(() => settle(false), budgetFor(total));
    unsubscribe = engine.subscribe(GENERATED_CHANNEL, () => settle(true));
  });
}
