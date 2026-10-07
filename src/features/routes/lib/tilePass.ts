/**
 * Waits for the heatmap tile pass Rust runs in the background.
 *
 * The worker announces the pass when it finishes, so nothing is read while it
 * draws. The budget is a foreground cap, not a deadline: Rust keeps drawing
 * after it expires and the map picks the tiles up as they land.
 */

import { engine } from 'veloqrs';

import { awaitEngineAnnouncement } from '@/shared/native/awaitEngineAnnouncement';
import { engineErrorTag } from '@/shared/native/engineError';

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

  // The figures only size the banner and the budget, so a failed read waits on
  // the default budget rather than failing the sync it sits in.
  let progress: number[] | null = null;
  try {
    progress = engine.getHeatmapTileProgress();
  } catch (error) {
    console.warn('[TilePass] Could not read the pass progress:', engineErrorTag(error) ?? error);
  }
  const [processed, total] = progress && progress.length >= 2 ? progress : [0, 0];
  onStarted?.(processed, total);

  return awaitEngineAnnouncement<boolean>({
    channel: GENERATED_CHANNEL,
    timeoutMs: budgetFor(total),
    // One read to retire the finished handle. A pass that outran the budget
    // is still running and is left alone.
    read: () => {
      engine.pollTileGeneration();
      return true;
    },
    onDeadline: () => false,
    subscribe: (channel, listener) => engine.subscribe(channel, listener),
  }).then(() => undefined);
}
