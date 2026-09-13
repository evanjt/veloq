/**
 * Await a heatmap cache-size walk that runs on a Rust thread.
 *
 * The walk is linear in cached tiles and was measured at 170 ms for 40,061 of
 * them on the CPH2653, against the 100 ms a mount has for the whole screen.
 * Started synchronously it froze the settings screen for the duration, so
 * Rust walks on its own thread and this only polls the figure.
 */

/** Cheap enough to poll at, short enough that a small tree still returns promptly. */
const POLL_INTERVAL_MS = 50;

/** A walk that has not finished by here is stuck, not slow. */
const WALK_TIMEOUT_MS = 30 * 1000;

export interface CacheSizeEngine {
  startHeatmapCacheSize(basePath: string): void;
  pollHeatmapCacheSize(): { state: string; bytes: number };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The tile cache's size in bytes.
 *
 * A walk that stops without a figure reads as zero rather than throwing: this
 * is a storage readout on a settings row, and a row that cannot show one
 * should still render.
 */
export async function readHeatmapCacheSize(
  engine: CacheSizeEngine,
  basePath: string,
  timeoutMs: number = WALK_TIMEOUT_MS
): Promise<number> {
  engine.startHeatmapCacheSize(basePath);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const poll = engine.pollHeatmapCacheSize();
    // Idle after a start means the walk finished under another caller's poll,
    // which is the second and third mount effect sharing one pass. The figure
    // outlives the poll that observed it, so both states carry it.
    if (poll.state !== 'running') return poll.bytes;
    if (Date.now() > deadline) return poll.bytes;
    await wait(POLL_INTERVAL_MS);
  }
}
