/**
 * Scenario: the engine throws a tagged failure while the stats hooks read it.
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
import { useFitnessScreenRead } from '@/features/fitness/hooks/useFitnessScreenRead';
import {
  NO_FITNESS_PARTS,
  noComparisons,
  summaryComparison,
} from '../__shared__/fitnessScreenRead';
import { useAthleteSummary } from '@/features/fitness/hooks/useAthleteSummary';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true }),
}));

const database = { tag: 'Database', inner: { msg: 'disk' } };
const failing = () => {
  throw database;
};

const engine = {
  subscribe: () => () => undefined,
  getFitnessScreenData: jest.fn(failing),
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
  it('the fitness screen read hands its calendar cards a thrown read rather than an empty year', async () => {
    const { result } = await renderHook(() => useFitnessScreenRead(), { wrapper: wrapper() });
    const { training } = result.current;
    expect(engineErrorTag(training.error)).toBe('Database');
    expect(training.isPending).toBe(false);
    expect(training.data.months).toEqual([]);
    expect(training.data.heatmap).toEqual([]);
  });

  it('useAthleteSummary reports a thrown read rather than an empty week', async () => {
    const { result } = await renderHook(() => useAthleteSummary(4), { wrapper: wrapper() });
    await waitFor(() => expect(engineErrorTag(result.current.error)).toBe('Database'));
    expect(result.current.data.currentWeek).toBeNull();
  });

  it('a read that answers nothing is not an error', async () => {
    const none = { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 };
    engine.getFitnessScreenData.mockImplementation(
      () =>
        ({
          ...NO_FITNESS_PARTS,
          heatmap: [],
          months: [],
          seasonYear: summaryComparison(0, { currentStats: none, previousStats: none }),
          seasonMonths: [summaryComparison(0, { currentStats: none, previousStats: none })],
          comparisons: noComparisons(0),
        }) as never
    );
    const screen = await renderHook(() => useFitnessScreenRead(), { wrapper: wrapper() });
    expect(screen.result.current.training.isPending).toBe(false);
    expect(screen.result.current.training.error).toBeNull();
  });
});
