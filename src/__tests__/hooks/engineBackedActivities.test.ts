/**
 * Scenario: the activity list and the timeline's oldest date are read from
 * SQLite. A window the launch sync did not cover has to be requested once, and
 * a corrupt row must not take the feed down.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useActivities,
  resetActivityWindowRequests,
} from '@/features/activity/hooks/useActivities';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
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
