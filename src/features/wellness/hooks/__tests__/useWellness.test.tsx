/**
 * Scenario: the wellness window slides with today's date while the cache is
 * persisted for 24 hours.
 *
 * Expected behaviour: a shifted window is a different query key, so the second
 * day fetches its own data instead of rendering yesterday's chart.
 */

import type { Config } from '@jest/types';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useWellness } from '@/features/wellness/hooks/useWellness';
import { queryKeys } from '@/shared/query/queryKeys';
import { intervalsApi } from '@/api';

jest.mock('@/api', () => ({
  intervalsApi: { getWellness: jest.fn() },
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

const mockGetWellness = intervalsApi.getWellness as jest.Mock;

// Fake only the clock, so react-query's own timers stay real.
const DATE_ONLY: Pick<Config.FakeTimersConfig, 'doNotFake'> = {
  doNotFake: [
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'setImmediate',
    'clearImmediate',
    'nextTick',
    'queueMicrotask',
    'performance',
  ],
};

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

let activeClient: QueryClient | undefined;

function newClient() {
  activeClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return activeClient;
}

afterEach(() => {
  // The 24 h gcTime arms a real timer that would keep the node process alive.
  activeClient?.clear();
  jest.useRealTimers();
  mockGetWellness.mockReset();
});

describe('queryKeys.wellness.byRange', () => {
  it('captures the window, so a shifted window is a different key', () => {
    const dayOne = queryKeys.wellness.byRange('7d', '2026-08-21', '2026-08-28');
    const dayTwo = queryKeys.wellness.byRange('7d', '2026-08-22', '2026-08-29');

    expect(dayOne).toEqual(['wellness', '7d', '2026-08-21', '2026-08-28']);
    expect(dayOne).not.toEqual(dayTwo);
  });

  it('keeps the wellness prefix, so blanket invalidation still matches', () => {
    const key = queryKeys.wellness.byRange('3m', '2026-05-30', '2026-08-28');
    expect(key.slice(0, queryKeys.wellness.all.length)).toEqual([...queryKeys.wellness.all]);
  });
});

describe('useWellness', () => {
  it('keys the cache on the window it fetched', async () => {
    jest.useFakeTimers({ ...DATE_ONLY, now: new Date('2026-08-28T09:00:00') });
    mockGetWellness.mockResolvedValue([]);
    const client = newClient();

    const { result } = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const key = queryKeys.wellness.byRange('7d', '2026-08-21', '2026-08-28');
    expect(client.getQueryData(key)).toEqual([]);
  });

  it('refetches on the next day instead of serving the stale window', async () => {
    jest.useFakeTimers({ ...DATE_ONLY, now: new Date('2026-08-28T09:00:00') });
    mockGetWellness.mockResolvedValue([{ id: '2026-08-28' }]);
    const client = newClient();

    const first = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    jest.setSystemTime(new Date('2026-08-29T09:00:00'));
    mockGetWellness.mockResolvedValue([{ id: '2026-08-29' }]);

    const second = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    // Yesterday's rows must not paint the chart while today's window loads.
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.data).toEqual([{ id: '2026-08-29' }]));

    expect(mockGetWellness).toHaveBeenCalledTimes(2);
    expect(mockGetWellness).toHaveBeenLastCalledWith({
      oldest: '2026-08-22',
      newest: '2026-08-29',
    });
  });
});
