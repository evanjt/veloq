/**
 * Scenario: the heatmap cache size was read with a blocking native walk from
 * three settings mount effects. At 40,061 cached tiles that walk measured
 * 170 ms on a second test handset, against the 100 ms a mount has for the whole screen.
 *
 * Expected behaviour: the walk runs on a Rust thread and this follows it, and
 * the engine's one take of the figure reaches every caller that asked while
 * the walk ran rather than the first alone.
 */

import { readHeatmapCacheSize } from '@/features/maps/lib/readHeatmapCacheSize';
import type { CacheSizeEngine } from '@/features/maps/lib/readHeatmapCacheSize';
import type { RunStatus } from 'veloqrs';

const BASE = '/cache/heatmap-tiles/';

function engineFrom(
  statuses: RunStatus[],
  figure: number | null
): CacheSizeEngine & { started: string[]; takes: number; cancels: number } {
  let n = 0;
  let held = figure;
  const engine = {
    started: [] as string[],
    takes: 0,
    cancels: 0,
    startHeatmapCacheSize: (basePath: string) => {
      engine.started.push(basePath);
    },
    readHeatmapCacheSizeRun: () => ({
      status: statuses[Math.min(n++, statuses.length - 1)],
      phase: '',
      completed: 0,
      total: 0,
      percent: 0,
    }),
    takeHeatmapCacheSize: () => {
      engine.takes += 1;
      const taken = held;
      held = null;
      return taken;
    },
    cancelHeatmapCacheSize: () => {
      engine.cancels += 1;
      return true;
    },
  };
  return engine;
}

describe('reading the heatmap cache size off the JS thread', () => {
  it('starts the walk and returns the figure it completes with', async () => {
    const engine = engineFrom(['running', 'running', 'complete'], 2048);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(2048);
    expect(engine.started).toEqual([BASE]);
  });

  it('returns the figure without waiting when the walk is already done', async () => {
    const engine = engineFrom(['complete'], 7);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(7);
  });

  it('gives every caller that asked during one walk the one figure', async () => {
    const engine = engineFrom(['running', 'complete'], 4096);

    const reads = [1, 2, 3].map(() => readHeatmapCacheSize(engine, BASE));

    await expect(Promise.all(reads)).resolves.toEqual([4096, 4096, 4096]);
    expect(engine.started).toEqual([BASE]);
    expect(engine.takes).toBe(1);
  });

  it('starts a fresh walk for a caller who asks after the last one ended', async () => {
    const engine = engineFrom(['complete'], 64);

    await readHeatmapCacheSize(engine, BASE);
    await readHeatmapCacheSize(engine, BASE);

    expect(engine.started).toEqual([BASE, BASE]);
  });

  it('abandons a walk that never finishes and reads zero', async () => {
    const engine = engineFrom(['running'], 512);

    await expect(readHeatmapCacheSize(engine, BASE, 0)).resolves.toBe(0);
    expect(engine.cancels).toBe(1);
  });

  it('reads zero for a walk that died rather than throwing', async () => {
    const engine = engineFrom(['failed'], null);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(0);
    expect(engine.takes).toBe(0);
  });

  it('reads zero for an empty tree rather than treating it as unknown', async () => {
    const engine = engineFrom(['complete'], 0);

    await expect(readHeatmapCacheSize(engine, BASE)).resolves.toBe(0);
  });

  it('does not count a suspension against the walk deadline', async () => {
    jest.useFakeTimers();
    try {
      let reads = 0;
      const engine = engineFrom(['running'], 99);
      engine.readHeatmapCacheSizeRun = () => {
        reads += 1;
        if (reads === 2) jest.setSystemTime(Date.now() + 180_000);
        return {
          status: reads < 5 ? 'running' : 'complete',
          phase: '',
          completed: 0,
          total: 0,
          percent: 0,
        };
      };

      const read = readHeatmapCacheSize(engine, BASE);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(read).resolves.toBe(99);
    } finally {
      jest.useRealTimers();
    }
  });
});
