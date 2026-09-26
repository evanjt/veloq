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

import { useWellness, toWellnessData } from '@/features/wellness/hooks/useWellness';
import type { WellnessDay } from 'veloqrs';
import { queryKeys } from '@/shared/query/queryKeys';
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

const mockGetWellnessDays = jest.fn<WellnessDay[], [string, string]>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getWellnessDays: mockGetWellnessDays }),
}));

/** A stored day with nothing on it but its date, for the window tests. */
function day(date: string): WellnessDay {
  return { date, sportLoad: [] };
}

jest.mock('@/shared/native/useEngineChannel', () => ({
  useEngineChannel: () => undefined,
}));

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
  mockGetWellnessDays.mockReset();
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
    mockGetWellnessDays.mockReturnValue([]);
    const client = newClient();

    const { result } = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const key = queryKeys.wellness.byRange('7d', '2026-08-21', '2026-08-28');
    expect(client.getQueryData(key)).toEqual([]);
  });

  it('refetches on the next day instead of serving the stale window', async () => {
    jest.useFakeTimers({ ...DATE_ONLY, now: new Date('2026-08-28T09:00:00') });
    mockGetWellnessDays.mockReturnValue([day('2026-08-28')]);
    const client = newClient();

    const first = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    jest.setSystemTime(new Date('2026-08-29T09:00:00'));
    mockGetWellnessDays.mockReturnValue([day('2026-08-29')]);

    const second = renderHook(() => useWellness('7d'), { wrapper: wrapper(client) });
    // Yesterday's rows must not paint the chart while today's window loads.
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.data?.[0].id).toBe('2026-08-29'));

    expect(mockGetWellnessDays).toHaveBeenCalledTimes(2);
    expect(mockGetWellnessDays).toHaveBeenLastCalledWith('2026-08-22', '2026-08-29');
  });
});

describe('toWellnessData', () => {
  it('renames the engine day onto what the screens read', () => {
    const mapped = toWellnessData({
      date: '2026-08-28',
      ctl: 42.5,
      atl: 38.1,
      restingHr: 51,
      sleepSecs: 27_000,
      sportLoad: [
        { sportGroup: 'Ride', load: 63 },
        { sportGroup: 'Run', load: 28 },
      ],
    });

    expect(mapped.id).toBe('2026-08-28');
    expect(mapped.ctl).toBe(42.5);
    expect(mapped.restingHR).toBe(51);
    expect(mapped.sleepSecs).toBe(27_000);
    expect(mapped.sportInfo?.map((s) => s.load)).toEqual([63, 28]);
  });

  // A field on `WellnessData` that the mapper never writes is one a screen can
  // ask for and always get `undefined` from. Nineteen accumulated that way.
  it('writes every field the screen type declares', () => {
    const mapped = toWellnessData({ date: '2026-08-28', sportLoad: [] });

    expect(Object.keys(mapped).sort()).toEqual(
      [
        'atl',
        'ctl',
        'fatigue',
        'hrv',
        'id',
        'mood',
        'motivation',
        'rampRate',
        'restingHR',
        'sleepScore',
        'sleepSecs',
        'soreness',
        'sportInfo',
        'stress',
        'weight',
      ].sort()
    );
  });

  // `ctlLoad` is the day's own load rather than a second spelling of the
  // fitness curve, so it stays in the body and never reaches a screen that
  // would print it as fitness.
  it('carries no daily-load field for a screen to mistake for fitness', () => {
    const mapped = toWellnessData({ date: '2026-08-28', sportLoad: [] });

    expect(mapped.ctl).toBeUndefined();
    expect('ctlLoad' in mapped).toBe(false);
    expect('atlLoad' in mapped).toBe(false);
  });
});
