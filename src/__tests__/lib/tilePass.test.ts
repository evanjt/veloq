/**
 * Scenario: a sync has started the heatmap tile pass and waits for it before
 * calling itself finished.
 *
 * Expected behaviour: nothing is read between the pass starting and Rust
 * announcing it, and the wait gives up on the foreground budget so a big pass
 * never holds the banner.
 */

import { awaitTilePass } from '@/features/routes/lib/tilePass';
import { engine } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();

jest.mock('veloqrs', () => ({
  engine: {
    pollTileGeneration: jest.fn(() => 'idle'),
    getHeatmapTileProgress: jest.fn(() => [0, 0]),
    subscribe: jest.fn((event: string, callback: MockListener) => {
      const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
      forEvent.add(callback);
      mockListeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    }),
  },
}));

const poll = engine.pollTileGeneration as unknown as jest.Mock;
const progress = engine.getHeatmapTileProgress as unknown as jest.Mock;

/** Stands in for the announcement the tile worker makes when it finishes. */
function announce() {
  mockListeners.get('tilesGenerated')?.forEach((listener) => listener());
}

describe('awaitTilePass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockListeners.clear();
    poll.mockReturnValue('idle');
    progress.mockReturnValue([0, 0]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns at once when no pass is running', async () => {
    const started = jest.fn();

    await awaitTilePass(started);

    expect(started).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('reads nothing between the pass starting and the announcement', async () => {
    poll.mockReturnValue('running');
    progress.mockReturnValue([0, 200]);

    const wait = awaitTilePass();
    const readsAtStart = poll.mock.calls.length + progress.mock.calls.length;
    jest.advanceTimersByTime(1_500);
    expect(poll.mock.calls.length + progress.mock.calls.length).toBe(readsAtStart);

    poll.mockReturnValue('complete');
    announce();

    await expect(wait).resolves.toBeUndefined();
  });

  it('reports the pass it is waiting on, once', async () => {
    poll.mockReturnValue('running');
    progress.mockReturnValue([3, 120]);
    const started = jest.fn();

    const wait = awaitTilePass(started);
    announce();
    await wait;

    expect(started).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledWith(3, 120);
  });

  it('retires the finished pass with a single read', async () => {
    poll.mockReturnValue('running');
    progress.mockReturnValue([0, 100]);

    const wait = awaitTilePass();
    const readsAtStart = poll.mock.calls.length;
    announce();
    await wait;

    expect(poll).toHaveBeenCalledTimes(readsAtStart + 1);
  });

  it.each([
    [0, 3_000],
    [50, 2_000],
    [300, 3_000],
    [900, 5_000],
  ])('gives a pass of %i tiles a %i ms budget', async (total, budget) => {
    poll.mockReturnValue('running');
    progress.mockReturnValue([0, total]);

    const settled = jest.fn();
    const wait = awaitTilePass().then(settled);

    jest.advanceTimersByTime(budget - 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await wait;
    expect(settled).toHaveBeenCalled();
  });

  it('leaves no listener or timer behind', async () => {
    poll.mockReturnValue('running');
    progress.mockReturnValue([0, 10]);

    const wait = awaitTilePass();
    announce();
    await wait;

    expect(mockListeners.get('tilesGenerated')?.size ?? 0).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('treats an unreadable progress read as an unknown total', async () => {
    poll.mockReturnValue('running');
    progress.mockReturnValue(null);
    const started = jest.fn();

    const settled = jest.fn();
    const wait = awaitTilePass(started).then(settled);
    expect(started).toHaveBeenCalledWith(0, 0);

    jest.advanceTimersByTime(3_000);
    await wait;

    expect(settled).toHaveBeenCalled();
  });
});
