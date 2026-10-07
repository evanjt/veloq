/**
 * Scenario: a FIT download refused by a dead connection records nothing and
 * announces nothing, so the `fitParsed` subscription never fires and the empty
 * list the query cached under `staleTime: Infinity` is what every later visit
 * renders.
 *
 * Expected behaviour: the offline to online edge invalidates the strength keys,
 * so the next read asks Rust again. A settled activity is not re-asked, because
 * the query answers from what the engine has stored.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useExerciseSets, useStrengthReconnect } from '@/features/strength/hooks/useExerciseSets';
import { getEngine } from '@/shared/native/engine';

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
  useIsOnline: () => mockIsOnline,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getExerciseSets: jest.fn(),
  isFitProcessed: jest.fn(),
  fetchAndParseExerciseSets: jest.fn(),
  bulkInsertExerciseSets: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The card and the app-lifetime subscriber, mounted together as the app has them. */
function useCardWithRetry(activityId: string) {
  useStrengthReconnect();
  return useExerciseSets(activityId, 'WeightTraining');
}

const sessionOf = (sets: unknown[]) => ({
  sets,
  groups: [],
  activeSetCount: sets.length,
  exerciseCount: 0,
  totalVolumeKg: 0,
  totalDurationSecs: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getExerciseSets.mockReturnValue(sessionOf([]));
  engine.isFitProcessed.mockReturnValue(false);
  engine.fetchAndParseExerciseSets.mockReturnValue(true);
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
});

afterEach(() => {
  client.clear();
});

it('asks again for a download the dead connection lost, on the reconnect edge', async () => {
  mockIsOnline = false;
  const { result, rerender } = renderHook(() => useCardWithRetry('act1'), { wrapper });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.data).toEqual([]));

  mockIsOnline = true;
  await act(async () => {
    rerender({});
  });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(2));
});

it('leaves a settled activity alone across the edge', async () => {
  engine.isFitProcessed.mockReturnValue(true);
  mockIsOnline = false;
  const { result, rerender } = renderHook(() => useCardWithRetry('act1'), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  mockIsOnline = true;
  await act(async () => {
    rerender({});
  });

  await waitFor(() => expect(engine.getExerciseSets).toHaveBeenCalledTimes(2));
  expect(result.current.data).toEqual([]);
  expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
});

it('stays quiet while the connection never drops', async () => {
  const { result, rerender } = renderHook(() => useCardWithRetry('act1'), { wrapper });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.data).toEqual([]));

  await act(async () => {
    rerender({});
  });

  expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1);
});
