/**
 * Scenario: the activity list and the timeline's oldest date are read from
 * SQLite. A window the launch sync did not cover has to be requested once, and
 * a corrupt row must not take the feed down.
 */

import { StartOutcome } from 'veloqrs';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useActivities,
  useInfiniteActivities,
  useRangeActivities,
} from '@/features/activity/hooks/useActivities';
import { emitSyncSettled } from '@/shared/app/useRetryTriggers';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { getEngine } from '@/shared/native/engine';
import { addDaysToDay } from '@/shared/time/startDate';
import { queryKeys } from '@/shared/query/queryKeys';

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
  getActivityBodies: jest.fn(),
  syncActivitiesWindow: jest.fn(),
  getSetting: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** A feed page of these bodies, none of them named upstream unless told otherwise. */
function page(bodies: string[], intervalsIds?: (string | null)[]) {
  return {
    bodies,
    intervalsIds: intervalsIds ?? bodies.map(() => null),
    matchedCount: bodies.length,
    hasMore: false,
  };
}

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getActivityBodies.mockReturnValue(page([]));
  engine.getSetting.mockReturnValue(null);
  engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
  mockIsOnline = true;
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

afterEach(() => {
  client.clear();
});

describe('useActivities', () => {
  it('parses stored bodies, keeping fields no Rust type models', async () => {
    engine.getActivityBodies.mockReturnValue(
      page([
        JSON.stringify({ id: 'a2', name: 'Newer', futureField: 'kept', calories: 900 }),
        JSON.stringify({ id: 'a1', name: 'Older' }),
      ])
    );

    const { result } = await renderHook(() => useActivities({ days: 30 }), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(result.current.data?.[0].id).toBe('a2');
    expect((result.current.data?.[0] as unknown as Record<string, unknown>).futureField).toBe(
      'kept'
    );
  });

  it('drops a corrupt row rather than failing the whole window', async () => {
    engine.getActivityBodies.mockReturnValue(
      page(['{broken', JSON.stringify({ id: 'a1' })], [null, 'i1'])
    );

    const { result } = await renderHook(() => useActivities({ days: 30 }), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].id).toBe('a1');
    expect(result.current.data?.[0].intervalsWebId).toBe('i1');
  });

  it('carries the id a web link may name, as the engine answers it, onto each activity', async () => {
    engine.getActivityBodies.mockReturnValue(
      page(
        [
          JSON.stringify({ id: 'i901', name: 'Synced' }),
          JSON.stringify({ id: 'demo-ride-1', name: 'Demo' }),
          JSON.stringify({ id: 'local-ride-1', name: 'Unsent' }),
          JSON.stringify({ id: 'local-ride-2', name: 'Uploaded' }),
        ],
        ['i901', null, null, 'i900']
      )
    );

    const { result } = renderHook(() => useActivities({ days: 30 }), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(4));
    expect(result.current.data?.map((a) => [a.id, a.intervalsWebId])).toEqual([
      ['i901', 'i901'],
      ['demo-ride-1', null],
      ['local-ride-1', null],
      ['local-ride-2', 'i900'],
    ]);
  });

  it('asks the engine to fill the window it is about to read', async () => {
    await renderHook(() => useActivities({ oldest: '2024-01-01', newest: '2024-06-01' }), {
      wrapper,
    });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalled());
    expect(engine.syncActivitiesWindow).toHaveBeenCalledWith('2024-01-01', '2024-06-01');
  });

  it('requests a given window only once', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = await renderHook(() => useActivities(opts), { wrapper });
    await rerender({});
    await rerender({});

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
  });

  it('re-asks for a window the engine refused', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Busy);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };

    const { rerender, unmount } = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    await unmount();

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await rerender({});
    await renderHook(() => useActivities(opts), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('re-asks for a window whose request threw', async () => {
    engine.syncActivitiesWindow.mockImplementation(() => {
      throw new Error('offline');
    });
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };

    const first = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    await first.unmount();

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await renderHook(() => useActivities(opts), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('asks again on the reconnect edge', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    mockIsOnline = false;
    await act(async () => await rerender({}));
    mockIsOnline = true;
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('keeps an accepted window to one ask while the connection holds', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(async () => await rerender({}));
    await act(async () => await rerender({}));

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('asks again for the same window after the athlete changes', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(() => useAuthStore.setState({ athleteId: 'i2' }));
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('asks again when the launch sync releases the exclusive slot', async () => {
    // The ordinary refusal is the launch sync holding the slot, not an offline
    // failure, and that ends without the user touching anything.
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Busy);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await act(() => emitSyncSettled());

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
    expect(engine.syncActivitiesWindow).toHaveBeenLastCalledWith('2024-01-01', '2024-06-01');
  });

  it('asks the engine again after a sync settles, because the engine owns the memory', async () => {
    // The census answers whether a window is already local, so a hook that
    // remembered an accepted window kept a second copy of that answer, and one
    // a relaunch emptied.
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.NotOwed);
    await act(() => emitSyncSettled());

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('names no running download for a window the engine says is not owed', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.NotOwed);
    const accepted = jest.spyOn(useSyncDateRange.getState(), 'windowAccepted');

    await renderHook(() => useActivities({ oldest: '2024-01-01', newest: '2024-06-01' }), {
      wrapper,
    });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    expect(accepted).not.toHaveBeenCalled();
  });

  it('stops asking once the hook is gone', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Busy);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { unmount } = await renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    await unmount();

    await act(() => emitSyncSettled());

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('runs an open-ended window to today rather than to nothing', async () => {
    await renderHook(() => useActivities({ oldest: '2024-01-01' }), { wrapper });

    await waitFor(() => expect(engine.getActivityBodies).toHaveBeenCalled());
    const [oldestTs, newestTs] = engine.getActivityBodies.mock.calls[0];
    expect(Number.isFinite(Number(newestTs))).toBe(true);
    expect(Number(newestTs)).toBeGreaterThan(Number(oldestTs));
    expect(engine.syncActivitiesWindow).toHaveBeenCalledWith('2024-01-01', expect.any(String));
  });

  it('reads a window as end-of-day inclusive', async () => {
    await renderHook(() => useActivities({ oldest: '2024-01-01', newest: '2024-01-02' }), {
      wrapper,
    });

    await waitFor(() => expect(engine.getActivityBodies).toHaveBeenCalled());
    const [oldestTs, newestTs] = engine.getActivityBodies.mock.calls[0];
    // A day of span plus the trailing 23:59:59 that makes `newest` inclusive.
    expect(newestTs - oldestTs).toBe(24 * 60 * 60 + 86399);
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
  it('re-asks for the feed pages when the launch sync releases the slot', async () => {
    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Busy);
    await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    engine.syncActivitiesWindow.mockReturnValue(StartOutcome.Started);
    await act(() => emitSyncSettled());

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('asks again for a feed page after the athlete changes', async () => {
    const { rerender } = await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    await act(() => useAuthStore.setState({ athleteId: 'i2' }));
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('re-asks for the feed window on the reconnect edge', async () => {
    const { rerender } = await renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    mockIsOnline = false;
    await act(async () => await rerender({}));
    mockIsOnline = true;
    await act(async () => await rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });
});

describe('useRangeActivities', () => {
  it('reads March 2024 from the engine with no scrolling and asks for nothing outside it', async () => {
    engine.getActivityBodies.mockReturnValue(
      page([JSON.stringify({ id: 'mar', name: 'March ride' })])
    );
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };

    const { result } = await renderHook(() => useRangeActivities(range), { wrapper });

    await waitFor(() => expect(result.current.allActivities.map((a) => a.id)).toContain('mar'));
    const windows = engine.getActivityBodies.mock.calls as [number, number][];
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

  it('reads nothing while no range is set', async () => {
    await renderHook(() => useRangeActivities(null), { wrapper });
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });
});
