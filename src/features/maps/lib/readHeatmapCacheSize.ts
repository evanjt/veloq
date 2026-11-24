/**
 * Await a heatmap cache-size walk that runs on a Rust thread.
 *
 * The walk is linear in cached tiles and was measured at 170 ms for 40,061 of
 * them on a second test handset, against the 100 ms a mount has for the whole screen.
 * Started synchronously it froze the settings screen for the duration, so
 * Rust walks on its own thread and this only follows the run.
 */

import { createAwakeClock } from '@/shared/app/awakeClock';
import type { RunProgress } from 'veloqrs';

/** Cheap enough to poll at, short enough that a small tree still returns promptly. */
const POLL_INTERVAL_MS = 50;

/** A walk that has not finished by here is stuck, not slow. */
const WALK_TIMEOUT_MS = 30 * 1000;

export interface CacheSizeEngine {
  startHeatmapCacheSize(basePath: string): unknown;
  readHeatmapCacheSizeRun(): RunProgress;
  takeHeatmapCacheSize(): number | null;
  cancelHeatmapCacheSize(): boolean;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The walk being followed, shared by every caller that asks while it runs.
 * The engine hands the figure over once, so three mount effects asking at once
 * follow one walk here rather than racing each other for the one take.
 */
let following: Promise<number | null> | null = null;

/**
 * The tile cache's size in bytes, or null when the walk could not say.
 *
 * A walk that stops without a figure, dies, or is abandoned at its deadline
 * reads null rather than throwing, so a settings row still renders. Null is
 * not zero: an empty tree answers 0, and a failed walk must not read as an
 * empty cache.
 */
export function readHeatmapCacheSize(
  engine: CacheSizeEngine,
  basePath: string,
  timeoutMs: number = WALK_TIMEOUT_MS
): Promise<number | null> {
  if (!following) {
    following = follow(engine, basePath, timeoutMs).finally(() => {
      following = null;
    });
  }
  return following;
}

async function follow(
  engine: CacheSizeEngine,
  basePath: string,
  timeoutMs: number
): Promise<number | null> {
  engine.startHeatmapCacheSize(basePath);

  const awake = createAwakeClock(POLL_INTERVAL_MS);
  const deadline = awake() + timeoutMs;
  for (;;) {
    const { status } = engine.readHeatmapCacheSizeRun();
    if (status === 'complete') return engine.takeHeatmapCacheSize();
    if (status !== 'running') return null;
    if (awake() > deadline) {
      engine.cancelHeatmapCacheSize();
      return null;
    }
    await wait(POLL_INTERVAL_MS);
  }
}
