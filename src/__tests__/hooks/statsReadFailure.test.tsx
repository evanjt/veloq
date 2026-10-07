/**
 * Scenario: the engine throws a tagged failure while the Training tab's stats
 * hooks read it.
 *
 * Expected behaviour: each hook hands the thrown value back as `error` and
 * keeps its empty value apart from it, so a screen can tell a failed read from
 * weeks the athlete did not ride. A read that succeeds carries no error.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { engineErrorTag } from '@/shared/native/engineError';
import { usePeriodStats, useTrainingScreenData } from '@/features/stats/hooks/useEngineStats';
import { useAthleteSummary } from '@/features/fitness/hooks/useAthleteSummary';
import { useActivityLabels } from '@/features/activity/hooks/useActivityLabels';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true }),
}));
jest.mock('@/features/activity/lib/activityLabels', () => ({
  activityLabels: jest.fn(() => {
    throw { tag: 'Database', inner: { msg: 'disk' } };
  }),
}));

const database = { tag: 'Database', inner: { msg: 'disk' } };
const failing = () => {
  throw database;
};

const engine = {
  subscribe: () => () => undefined,
  getPeriodStats: jest.fn(failing),
  getTrainingScreenData: jest.fn(failing),
  getWeeklySummaries: jest.fn(failing),
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('stats hooks', () => {
  it('usePeriodStats reports a thrown read rather than zero totals', async () => {
    const { result } = renderHook(() => usePeriodStats(0, 100), { wrapper: wrapper() });
    await waitFor(() => expect(engineErrorTag(result.current.error)).toBe('Database'));
    expect(result.current.isPending).toBe(false);
  });

  it('useTrainingScreenData reports a thrown read rather than an empty year', async () => {
    const { result } = renderHook(() => useTrainingScreenData(), { wrapper: wrapper() });
    await waitFor(() => expect(engineErrorTag(result.current.error)).toBe('Database'));
    expect(result.current.isPending).toBe(false);
    expect(result.current.data.months).toEqual([]);
    expect(result.current.data.heatmap).toEqual([]);
  });

  it('useAthleteSummary reports a thrown read rather than an empty week', async () => {
    const { result } = renderHook(() => useAthleteSummary(4), { wrapper: wrapper() });
    await waitFor(() => expect(engineErrorTag(result.current.error)).toBe('Database'));
    expect(result.current.data.currentWeek).toBeNull();
  });

  it('useActivityLabels reports a thrown read rather than no labels', async () => {
    const { result } = renderHook(() => useActivityLabels(['a1']), { wrapper: wrapper() });
    await waitFor(() => expect(engineErrorTag(result.current.error)).toBe('Database'));
    expect(result.current.labels.size).toBe(0);
  });

  it('a read that answers nothing is not an error', async () => {
    engine.getPeriodStats.mockImplementation(
      () => ({ count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 }) as never
    );
    const none = { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 };
    engine.getTrainingScreenData.mockImplementation(
      () =>
        ({
          heatmap: [],
          months: [],
          yearCurrent: none,
          yearPrevious: none,
          monthCurrent: none,
          monthPrevious: none,
        }) as never
    );
    const period = renderHook(() => usePeriodStats(0, 100), { wrapper: wrapper() });
    const training = renderHook(() => useTrainingScreenData(), { wrapper: wrapper() });
    await waitFor(() => expect(period.result.current.isPending).toBe(false));
    await waitFor(() => expect(training.result.current.isPending).toBe(false));
    expect(period.result.current.error).toBeNull();
    expect(training.result.current.error).toBeNull();
  });
});
