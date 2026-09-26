/**
 * Scenario: a map tap starts one activity while a 500-activity sync is
 * downloading. The tap queues behind the sync, so its own fetch finishes
 * seconds later, but the poll read a global flag that stays true for as long as
 * anything is queued. The tap's screen sat on a progress bar counting someone
 * else's activities.
 *
 * Expected behaviour: a caller polls its own run, so it settles when its own
 * run leaves the queue, whatever else is still downloading.
 */

import { pollDownloadProgress, runProgressReader } from '@/features/routes/lib/gpsDownloadPoll';

const noWait = () => Promise.resolve();

/** A stand-in for the engine's queue: several runs, each with its own counters. */
function queue(runs: Record<string, { completed: number; total: number }[]>) {
  const left = { ...runs };
  return (run: bigint) => {
    const readings = left[run.toString()];
    const next = readings?.shift();
    return next ? { active: true, ...next } : { active: false, completed: 0, total: 0 };
  };
}

describe('polling one download run', () => {
  it('settles when the caller’s own run leaves, with another still downloading', async () => {
    const read = queue({
      '1': Array.from({ length: 50 }, (_, i) => ({ completed: i, total: 500 })),
      '2': [{ completed: 0, total: 1 }],
    });

    const outcome = await pollDownloadProgress({
      read: runProgressReader(2n, read),
      wait: noWait,
    });

    expect(outcome).toBe('settled');
    expect(read(1n).active).toBe(true);
  });

  it('reports the caller’s own counters, not the queue head’s', async () => {
    const seen: number[] = [];
    const read = queue({
      '2': [
        { completed: 1, total: 4 },
        { completed: 2, total: 4 },
      ],
    });

    await pollDownloadProgress({
      read: runProgressReader(2n, read),
      wait: noWait,
      onProgress: (p) => seen.push(p.completed),
    });

    expect(seen).toEqual([1, 2]);
  });
});
