/**
 * Scenario: the heatmap cache size was read with a blocking native walk from
 * three settings mount effects. At 40,061 cached tiles that walk measured
 * 170 ms on the CPH2653, against the 100 ms a mount has for the whole screen.
 *
 * Expected behaviour: the walk runs on a Rust thread and this polls it, the
 * `startBackup` shape, and a caller that arrives after another caller's poll
 * observed completion still reads the figure rather than zero.
 */

import { readHeatmapCacheSize } from '@/features/maps/lib/readHeatmapCacheSize';
import type { CacheSizeEngine } from '@/features/maps/lib/readHeatmapCacheSize';

const BASE = '/cache/heatmap-tiles/';

function engineFrom(polls: { state: string; bytes: number }[]): CacheSizeEngine & {
  started: string[];
} {
  const started: string[] = [];
  let n = 0;
  return {
    started,
    startHeatmapCacheSize: (basePath) => {
      started.push(basePath);
    },
    pollHeatmapCacheSize: () => polls[Math.min(n++, polls.length - 1)],
  };
}

describe('reading the heatmap cache size off the JS thread', () => {
  it('starts the walk and returns the figure it completes with', async () => {
    const engine = engineFrom([
      { state: 'running', bytes: 0 },
      { state: 'running', bytes: 0 },
      { state: 'complete', bytes: 2048 },
    ]);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(2048);
    expect(engine.started).toEqual([BASE]);
  });

  it('reads the figure from an idle poll, which is a walk another caller finished', async () => {
    const engine = engineFrom([{ state: 'idle', bytes: 4096 }]);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(4096);
  });

  it('returns the figure without waiting when the walk is already done', async () => {
    const engine = engineFrom([{ state: 'complete', bytes: 7 }]);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(7);
  });

  it('gives up on a walk that never finishes, with the last figure it had', async () => {
    const engine = engineFrom([{ state: 'running', bytes: 512 }]);

    await expect(readHeatmapCacheSize(engine, BASE, 0)).resolves.toBe(512);
  });

  it('reads zero for an empty tree rather than treating it as unknown', async () => {
    const engine = engineFrom([{ state: 'complete', bytes: 0 }]);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(0);
  });
});
