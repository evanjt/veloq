/**
 * Scenario: the activity list and the timeline's oldest date are read from
 * SQLite. A window the launch sync did not cover has to be requested once, and
 * a corrupt row must not take the feed down.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useActivities,
  useInfiniteActivities,
  resetActivityWindowRequests,
} from '@/features/activity/hooks/useActivities';
import { emitSyncSettled } from '@/shared/app/useRetryTriggers';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline, isInternetReachable: null, connectionType: null }),
}));

const engine = {
  getActivityBodies: jest.fn(),
  syncActivitiesWindow: jest.fn(),
  getSetting: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetActivityWindowRequests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetRouteEngine.mockReturnValue(engine as unknown as ReturnType<typeof getRouteEngine>);
  engine.getActivityBodies.mockReturnValue([]);
  engine.getSetting.mockReturnValue(null);
  engine.syncActivitiesWindow.mockReturnValue(true);
  mockIsOnline = true;
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

afterEach(() => {
  client.clear();
});

describe('useActivities', () => {
  it('parses stored bodies, keeping fields no Rust type models', async () => {
    engine.getActivityBodies.mockReturnValue([
      JSON.stringify({ id: 'a2', name: 'Newer', locality: 'Sion', calories: 900 }),
      JSON.stringify({ id: 'a1', name: 'Older', locality: 'Bern' }),
    ]);

    const { result } = renderHook(() => useActivities({ days: 30 }), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(result.current.data?.[0].id).toBe('a2');
    expect((result.current.data?.[0] as unknown as Record<string, unknown>).locality).toBe('Sion');
  });

  it('drops a corrupt row rather than failing the whole window', async () => {
    engine.getActivityBodies.mockReturnValue(['{broken', JSON.stringify({ id: 'a1' })]);

    const { result } = renderHook(() => useActivities({ days: 30 }), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].id).toBe('a1');
  });

  it('asks the engine to fill the window it is about to read', async () => {
    renderHook(() => useActivities({ oldest: '2024-01-01', newest: '2024-06-01' }), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalled());
    expect(engine.syncActivitiesWindow).toHaveBeenCalledWith('2024-01-01', '2024-06-01');
  });

  it('requests a given window only once', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = renderHook(() => useActivities(opts), { wrapper });
    rerender({});
    rerender({});

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
  });

  it('re-asks for a window the engine refused', async () => {
    engine.syncActivitiesWindow.mockReturnValue(false);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };

    const { rerender, unmount } = renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    unmount();

    engine.syncActivitiesWindow.mockReturnValue(true);
    rerender({});
    renderHook(() => useActivities(opts), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('re-asks for a window whose request threw', async () => {
    engine.syncActivitiesWindow.mockImplementation(() => {
      throw new Error('offline');
    });
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };

    const first = renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    first.unmount();

    engine.syncActivitiesWindow.mockReturnValue(true);
    renderHook(() => useActivities(opts), { wrapper });

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('asks again on the reconnect edge', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    mockIsOnline = false;
    act(() => rerender({}));
    mockIsOnline = true;
    act(() => rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('keeps an accepted window to one ask while the connection holds', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { rerender } = renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    act(() => rerender({}));
    act(() => rerender({}));

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('asks again when the launch sync releases the exclusive slot', async () => {
    // The ordinary refusal is the launch sync holding the slot, not an offline
    // failure, and that ends without the user touching anything.
    engine.syncActivitiesWindow.mockReturnValue(false);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    engine.syncActivitiesWindow.mockReturnValue(true);
    act(() => emitSyncSettled());

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
    expect(engine.syncActivitiesWindow).toHaveBeenLastCalledWith('2024-01-01', '2024-06-01');
  });

  it('does not re-ask a window the engine already accepted', async () => {
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    act(() => emitSyncSettled());
    act(() => emitSyncSettled());

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the hook is gone', async () => {
    engine.syncActivitiesWindow.mockReturnValue(false);
    const opts = { oldest: '2024-01-01', newest: '2024-06-01' };
    const { unmount } = renderHook(() => useActivities(opts), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));
    unmount();

    act(() => emitSyncSettled());

    expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1);
  });

  it('reads a window as end-of-day inclusive', async () => {
    renderHook(() => useActivities({ oldest: '2024-01-01', newest: '2024-01-02' }), { wrapper });

    await waitFor(() => expect(engine.getActivityBodies).toHaveBeenCalled());
    const [oldestTs, newestTs] = engine.getActivityBodies.mock.calls[0];
    // A day of span plus the trailing 23:59:59 that makes `newest` inclusive.
    expect(newestTs - oldestTs).toBe(24 * 60 * 60 + 86399);
  });
});

describe('useOldestActivityDate', () => {
  it('returns the date the sync stored', async () => {
    engine.getSetting.mockReturnValue('2019-04-02T06:00:00');

    const { result } = renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.getFullYear()).toBe(2019);
  });

  it('returns null before the first sync has stored one', async () => {
    const { result } = renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns null for an unparseable stored value', async () => {
    engine.getSetting.mockReturnValue('not a date');

    const { result } = renderHook(() => useOldestActivityDate(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useInfiniteActivities', () => {
  it('re-asks for the feed pages when the launch sync releases the slot', async () => {
    engine.syncActivitiesWindow.mockReturnValue(false);
    renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    engine.syncActivitiesWindow.mockReturnValue(true);
    act(() => emitSyncSettled());

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });

  it('re-asks for the feed window on the reconnect edge', async () => {
    const { rerender } = renderHook(() => useInfiniteActivities(), { wrapper });
    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(1));

    mockIsOnline = false;
    act(() => rerender({}));
    mockIsOnline = true;
    act(() => rerender({}));

    await waitFor(() => expect(engine.syncActivitiesWindow).toHaveBeenCalledTimes(2));
  });
});
