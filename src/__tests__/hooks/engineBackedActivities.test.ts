/**
 * Scenario: the feed's cards and the timeline's oldest date are read from
 * SQLite, and a window the launch sync did not cover has to be requested once.
 *
 * A window that failed for the connection is the engine's to ask again, on the
 * online edge it is pushed, so the reconnect edge asks nothing from here.
 */

import { StartOutcome } from 'veloqrs';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useActivityWindowRequest,
  useInfiniteActivities,
  useRangeActivities,
} from '@/features/activity/hooks/useActivities';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { getEngine } from '@/shared/native/engine';
import { addDaysToDay } from '@/shared/time/startDate';
import { queryKeys } from '@/shared/query/queryKeys';
import { feedCard } from '../__shared__/feedCard';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

let mockIsOnline = true;
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
  useIsOnline: () => mockIsOnline,
}));

const engine = {
  getFeedCards: jest.fn(),
  syncActivitiesWindow: jest.fn(),
  getSetting: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getFeedCards.mockReturnValue([]);
  engine.getSetting.mockReturnValue(null);
  engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
  mockIsOnline = true;
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

afterEach(() => {
  client.clear();
});

/** Drop the connection and bring it back, letting every effect and refetch run. */
async function reconnect(rerender: (props: object) => Promise<void> | void): Promise<void> {
  mockIsOnline = false;
  await act(async () => await rerender({}));
  mockIsOnline = true;
  await act(async () => await rerender({}));
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('useActivityWindowRequest', () => {
  it('asks the engine to fill the window', async () => {
    await renderHook(() => useActivityWindowRequest('2024-01-01', '2024-06-01'), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalled());
    expect(engine.syncActivitiesWindow).toHaveBeenCalledWith('2024-01-01', '2024-06-01');
  });

  it('requests a given window only once', async () => {
    const { rerender } = await renderHook(
      () => useActivityWindowRequest('2024-01-01', '2024-06-01'),
      { wrapper }
    );
    await rerender({});
    await rerender({});

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
  });

  it('re-asks for a window the engine refused', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Busy);

    const { rerender, unmount } = await renderHook(
      () => useActivityWindowRequest('2024-01-01', '2024-06-01'),
      { wrapper }
    );
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    await unmount();

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await rerender({});
    await renderHook(() => useActivityWindowRequest('2024-01-01', '2024-06-01'), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('re-asks for a window whose request threw', async () => {
    engine.syncActivitiesWindow.mockImplementation(() => {
      throw new Error('offline');
    });

    const first = await renderHook(() => useActivityWindowRequest('2024-01-01', '2024-06-01'), {
      wrapper,
    });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    await first.unmount();

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await renderHook(() => useActivityWindowRequest('2024-01-01', '2024-06-01'), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('leaves a window to the engine on the reconnect edge', async () => {
    const { rerender } = await renderHook(
      () => useActivityWindowRequest('2024-01-01', '2024-06-01'),
      { wrapper }
    );
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await reconnect(rerender);

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('keeps an accepted window to one ask while the connection holds', async () => {
    const { rerender } = await renderHook(
      () => useActivityWindowRequest('2024-01-01', '2024-06-01'),
      { wrapper }
    );
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(async () => await rerender({}));
    await act(async () => await rerender({}));

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('asks again for the same window after the athlete changes', async () => {
    const { rerender } = await renderHook(
      () => useActivityWindowRequest('2024-01-01', '2024-06-01'),
      { wrapper }
    );
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(() => useAuthStore.setState({ athleteId: 'i2' }));
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('names no running download for a window the engine says is not owed', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.NotOwed);
    const accepted = jest.spyOn(useSyncDateRange.getState(), 'windowAccepted');

    await renderHook(() => useActivityWindowRequest('2024-01-01', '2024-06-01'), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    expect(accepted).not.toHaveBeenCalled();
  });
});

describe('useOldestActivityDate', () => {
  it('returns the date the sync stored', async () => {
    engine.getSetting.mockReturnValue('2019-04-02T06:00:00');

    const { result } = await renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.getFullYear()).toBe(2019);
  });

  it('returns null before the first sync has stored one', async () => {
    const { result } = await renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns null for an unparseable stored value', async () => {
    engine.getSetting.mockReturnValue('not a date');

    const { result } = await renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useInfiniteActivities', () => {
  it('lists the cards the engine typed for the window', async () => {
    engine.getFeedCards.mockReturnValue([
      feedCard({ id: 'local-ride-3', name: 'Canal path', intervalsWebId: 'i903', hasGps: true }),
    ]);

    const { result } = await renderHook(() => useInfiniteActivities(), { wrapper });

    await waitFor(() => expect(result.current.allActivities).toHaveLength(1));
    expect(result.current.allActivities[0]).toMatchObject({
      id: 'local-ride-3',
      intervalsWebId: 'i903',
      hasGps: true,
    });
  });

  it('can page back to the newest window after the cap evicts it', async () => {
    const { result } = await renderHook(() => useInfiniteActivities(), { wrapper });
    const head = () => (result.current.data?.pageParams[0] as { newest: string }).newest;
    // The fetch resolves before React renders its result, so wait for the rendered head to match.
    const page = async (direction: 'fetchNextPage' | 'fetchPreviousPage') => {
      let settled: { newest: string } | undefined;
      await act(async () => {
        const fetched = await result.current[direction]();
        settled = fetched.data?.pageParams[0] as { newest: string };
      });
      await waitFor(() => expect(head()).toBe(settled?.newest));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
    };
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    const newest = head();

    for (let n = 0; n < 15 && head() === newest; n += 1) {
      await page('fetchNextPage');
    }

    expect(result.current.data?.pages).toHaveLength(10);
    expect(head()).not.toBe(newest);
    expect(result.current.hasPreviousPage).toBe(true);
    await page('fetchPreviousPage');
    expect(result.current.data?.pages).toHaveLength(10);

    for (let n = 0; n < 11 && result.current.hasPreviousPage; n += 1) {
      await page('fetchPreviousPage');
    }
    expect(head()).toBe(newest);
    expect(result.current.hasPreviousPage).toBe(false);
  });

  it('stops paging after the known oldest activity', async () => {
    const { result } = await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(result.current.data?.pageParams).toHaveLength(1));
    const first = result.current.data?.pageParams[0] as { oldest: string };
    const oldest = addDaysToDay(first.oldest, -5);
    await act(() =>
      client.setQueryData(queryKeys.calendar.oldestDate, new Date(`${oldest}T12:00:00Z`))
    );

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
  it('asks again for a feed page after the athlete changes', async () => {
    const { rerender } = await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(() => useAuthStore.setState({ athleteId: 'i2' }));
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('leaves the feed window to the engine on the reconnect edge', async () => {
    const { rerender } = await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await reconnect(rerender);

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });
});

describe('useRangeActivities', () => {
  it('reads March 2024 from the engine with no scrolling and asks for nothing outside it', async () => {
    engine.getFeedCards.mockReturnValue([feedCard({ id: 'mar', name: 'March ride' })]);
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };

    const { result } = await renderHook(() => useRangeActivities(range), { wrapper });

    await waitFor(() => expect(result.current.allActivities.map((a) => a.id)).toContain('mar'));
    const windows = engine.getFeedCards.mock.calls as [number, number][];
    expect(windows[0][1]).toBe(Date.UTC(2024, 2, 31, 23, 59, 59) / 1000);
    for (const [from, to] of windows) {
      expect(from).toBeGreaterThanOrEqual(Date.UTC(2024, 2, 1) / 1000);
      expect(to).toBeLessThanOrEqual(Date.UTC(2024, 2, 31, 23, 59, 59) / 1000);
    }
    expect(engine.syncActivitiesWindow).toHaveBeenCalledWith('2024-03-02', '2024-03-31');
  });

  it('stops paging at the first day of the range', async () => {
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };
    const { result } = await renderHook(() => useRangeActivities(range), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(engine.syncActivitiesWindow).toHaveBeenLastCalledWith('2024-03-01', '2024-03-01');
  });

  it('leaves the range window to the engine on the reconnect edge', async () => {
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };
    const { rerender } = await renderHook(() => useRangeActivities(range), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await reconnect(rerender);

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while no range is set', async () => {
    await renderHook(() => useRangeActivities(null), { wrapper });
    expect(engine.getFeedCards).not.toHaveBeenCalled();
  });
});
