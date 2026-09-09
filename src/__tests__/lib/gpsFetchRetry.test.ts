import { fetchWithRetry, type FetchPass } from '@/features/routes/lib/gpsFetchRetry';

/**
 * Scenario: `startFetchAndStore` reports its failures in `failedIds` and the
 * caller read the length and dropped the ids.
 * Expected behaviour: the failed ids are re-offered, over the failed set
 * alone, a bounded number of times, and what still fails is reported.
 */

function pass(overrides: Partial<FetchPass> = {}): FetchPass {
  return { syncedIds: [], failedIds: [], total: 0, successCount: 0, ...overrides };
}

const noWait = () => Promise.resolve();

describe('retrying the GPS downloads that failed', () => {
  it('runs one pass and stops when nothing failed', async () => {
    const run = jest
      .fn()
      .mockResolvedValue(pass({ syncedIds: ['a', 'b'], total: 2, successCount: 2 }));

    const summary = await fetchWithRetry(['a', 'b'], { pass: run, wait: noWait });

    expect(run).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(
      expect.objectContaining({
        syncedIds: ['a', 'b'],
        failedIds: [],
        total: 2,
        successCount: 2,
        attempts: 1,
        recoveredIds: [],
      })
    );
  });

  it('re-offers only the ids that failed', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(pass({ syncedIds: ['a'], failedIds: ['b', 'c'], total: 3 }))
      .mockResolvedValueOnce(pass({ syncedIds: ['b', 'c'], total: 2 }));

    const summary = await fetchWithRetry(['a', 'b', 'c'], { pass: run, wait: noWait });

    expect(run).toHaveBeenNthCalledWith(1, ['a', 'b', 'c']);
    expect(run).toHaveBeenNthCalledWith(2, ['b', 'c']);
    expect(summary?.syncedIds).toEqual(['a', 'b', 'c']);
    expect(summary?.failedIds).toEqual([]);
    expect(summary?.recoveredIds).toEqual(['b', 'c']);
    expect(summary?.successCount).toBe(3);
    expect(summary?.total).toBe(3);
  });

  it('keeps the partial recovery when a retry fails again', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(pass({ syncedIds: ['a'], failedIds: ['b', 'c'], total: 3 }))
      .mockResolvedValueOnce(pass({ syncedIds: ['b'], failedIds: ['c'], total: 2 }))
      .mockResolvedValueOnce(pass({ failedIds: ['c'], total: 1 }));

    const summary = await fetchWithRetry(['a', 'b', 'c'], { pass: run, wait: noWait });

    expect(run).toHaveBeenCalledTimes(3);
    expect(summary?.syncedIds).toEqual(['a', 'b']);
    expect(summary?.failedIds).toEqual(['c']);
    expect(summary?.recoveredIds).toEqual(['b']);
    expect(summary?.attempts).toBe(3);
  });

  it('stops at maxAttempts rather than retrying for ever', async () => {
    const run = jest.fn().mockResolvedValue(pass({ failedIds: ['a'], total: 1 }));

    const summary = await fetchWithRetry(['a'], { pass: run, wait: noWait, maxAttempts: 2 });

    expect(run).toHaveBeenCalledTimes(2);
    expect(summary?.failedIds).toEqual(['a']);
    expect(summary?.successCount).toBe(0);
  });

  it('waits longer before each retry', async () => {
    const waited: number[] = [];
    const run = jest.fn().mockResolvedValue(pass({ failedIds: ['a'], total: 1 }));

    await fetchWithRetry(['a'], {
      pass: run,
      wait: (ms) => {
        waited.push(ms);
        return Promise.resolve();
      },
      retryDelayMs: 200,
    });

    expect(waited).toEqual([200, 400]);
  });

  it('does not start a retry once the caller has gone away', async () => {
    const run = jest.fn().mockResolvedValue(pass({ failedIds: ['a'], total: 1 }));

    const summary = await fetchWithRetry(['a'], {
      pass: run,
      wait: noWait,
      isActive: () => false,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(summary?.failedIds).toEqual(['a']);
  });

  it('answers null when the first pass gives no result', async () => {
    const run = jest.fn().mockResolvedValue(null);

    await expect(fetchWithRetry(['a'], { pass: run, wait: noWait })).resolves.toBeNull();
  });

  it('keeps the first pass when a retry gives no result', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(pass({ syncedIds: ['a'], failedIds: ['b'], total: 2 }))
      .mockResolvedValueOnce(null);

    const summary = await fetchWithRetry(['a', 'b'], { pass: run, wait: noWait });

    expect(run).toHaveBeenCalledTimes(2);
    expect(summary?.syncedIds).toEqual(['a']);
    expect(summary?.failedIds).toEqual(['b']);
  });

  it('runs no pass at all for an empty set', async () => {
    const run = jest.fn();

    const summary = await fetchWithRetry([], { pass: run, wait: noWait });

    expect(run).not.toHaveBeenCalled();
    expect(summary).toEqual(
      expect.objectContaining({ syncedIds: [], failedIds: [], total: 0, attempts: 0 })
    );
  });

  it('reports each retry as it starts', async () => {
    const onRetry = jest.fn();
    const run = jest
      .fn()
      .mockResolvedValueOnce(pass({ failedIds: ['a'], total: 1 }))
      .mockResolvedValueOnce(pass({ syncedIds: ['a'], total: 1 }));

    await fetchWithRetry(['a'], { pass: run, wait: noWait, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(['a'], 2);
  });
});
