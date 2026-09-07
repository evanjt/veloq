import { pollDownloadProgress } from '@/features/routes/lib/gpsDownloadPoll';

/**
 * Scenario: the engine's `active` flag was the only thing the GPS poll broke
 * on, and a panic in the fetch thread strands it true for the life of the
 * process.
 * Expected behaviour: the poll ends on its own once the counters stop moving,
 * still ends the moment the download settles, and never calls a slow download
 * stuck while it is still making progress.
 */

const noWait = () => Promise.resolve();

/** A clock the test advances by hand, so no test waits on a real one. */
function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe('polling one GPS download to its end', () => {
  it('ends the moment the engine clears the flag', async () => {
    const readings = [
      { active: true, completed: 1, total: 3 },
      { active: true, completed: 2, total: 3 },
      { active: false, completed: 3, total: 3 },
    ];
    const read = jest.fn(() => readings.shift() ?? { active: false, completed: 3, total: 3 });

    await expect(pollDownloadProgress({ read, wait: noWait })).resolves.toBe('settled');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('gives up once the counters have stood still for the stall budget', async () => {
    const time = clock();
    const read = jest.fn(() => {
      time.advance(100);
      return { active: true, completed: 4, total: 10 };
    });

    const outcome = await pollDownloadProgress({
      read,
      wait: noWait,
      now: time.now,
      stallMs: 1000,
    });

    expect(outcome).toBe('stalled');
    // The first reading sets the mark, so the budget runs from there.
    expect(read.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('does not call a slow download stuck while it is still moving', async () => {
    const time = clock();
    let completed = 0;
    const read = jest.fn(() => {
      time.advance(900);
      completed += 1;
      return { active: completed < 20, completed, total: 20 };
    });

    await expect(
      pollDownloadProgress({ read, wait: noWait, now: time.now, stallMs: 1000 })
    ).resolves.toBe('settled');
    expect(completed).toBe(20);
  });

  it('stops when the caller goes away, without reading again', async () => {
    let live = true;
    const read = jest.fn(() => {
      live = false;
      return { active: true, completed: 0, total: 5 };
    });

    const outcome = await pollDownloadProgress({
      read,
      wait: noWait,
      isActive: () => live,
    });

    expect(outcome).toBe('cancelled');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads nothing at all when the caller is already gone', async () => {
    const read = jest.fn(() => ({ active: true, completed: 0, total: 5 }));

    await expect(pollDownloadProgress({ read, wait: noWait, isActive: () => false })).resolves.toBe(
      'cancelled'
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('reports each reading while the download is still running', async () => {
    const readings = [
      { active: true, completed: 1, total: 2 },
      { active: false, completed: 2, total: 2 },
    ];
    const seen: number[] = [];

    await pollDownloadProgress({
      read: () => readings.shift() ?? { active: false, completed: 2, total: 2 },
      onProgress: (p) => seen.push(p.completed),
      wait: noWait,
    });

    // The settled reading is not progress, it is the end.
    expect(seen).toEqual([1]);
  });
});
