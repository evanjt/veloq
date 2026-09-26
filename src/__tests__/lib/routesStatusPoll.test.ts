/**
 * Scenario: two routes screens follow two background jobs, and each used to
 * carry its own interval over its own export. Two followers meant four engine
 * calls a tick, and the figures could disagree because they were taken at
 * different moments.
 *
 * Expected behaviour: one tick is one read whoever is following, every
 * follower sees the same snapshot, and the timer exists only while something
 * is being followed.
 */

import { getEngine } from '@/shared/native/engine';
import {
  ROUTES_STATUS_POLL_MS,
  followRoutesStatus,
  readRoutesStatus,
  routesStatusIsFollowed,
} from '@/shared/native/routesStatusPoll';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const getRoutesStatusData = jest.fn(() => ({
  detection: null,
  elevation: { phase: 'fetching', completed: 3, total: 9, failed: 0, percent: 33 },
  elevationRemaining: null,
  elevationPaused: false,
  cutover: { phase: 'detecting', running: true },
  heatmapTiles: [0, 0],
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue({ getRoutesStatusData } as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the routes status poller', () => {
  it('reads once a tick however many are following', () => {
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = followRoutesStatus(first);
    const offSecond = followRoutesStatus(second);

    jest.advanceTimersByTime(ROUTES_STATUS_POLL_MS);

    expect(getRoutesStatusData).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // The same object, so two screens cannot disagree about one instant.
    expect(first.mock.calls[0][0]).toBe(second.mock.calls[0][0]);

    offFirst();
    offSecond();
  });

  it('arms with the first follower and disarms with the last', () => {
    expect(routesStatusIsFollowed()).toBe(false);

    const offFirst = followRoutesStatus(jest.fn());
    const offSecond = followRoutesStatus(jest.fn());
    expect(routesStatusIsFollowed()).toBe(true);

    offFirst();
    expect(routesStatusIsFollowed()).toBe(true);

    offSecond();
    expect(routesStatusIsFollowed()).toBe(false);

    jest.advanceTimersByTime(ROUTES_STATUS_POLL_MS * 4);
    expect(getRoutesStatusData).not.toHaveBeenCalled();
  });

  it('lets a follower stop from inside its own callback', () => {
    const seen: unknown[] = [];
    let off: (() => void) | undefined;
    off = followRoutesStatus((status) => {
      seen.push(status);
      off?.();
    });
    const other = jest.fn();
    const offOther = followRoutesStatus(other);

    jest.advanceTimersByTime(ROUTES_STATUS_POLL_MS);

    expect(seen).toHaveLength(1);
    expect(other).toHaveBeenCalledTimes(1);

    offOther();
  });

  it('answers null rather than throwing when the engine cannot be read', () => {
    mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);
    expect(readRoutesStatus()).toBeNull();

    mockGetEngine.mockReturnValue({
      getRoutesStatusData: () => {
        throw new Error('engine is closed');
      },
    } as unknown as ReturnType<typeof getEngine>);
    expect(readRoutesStatus()).toBeNull();
  });
});
