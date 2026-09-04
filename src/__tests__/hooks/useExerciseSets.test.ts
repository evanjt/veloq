/**
 * Scenario: a WeightTraining card reads its sets from SQLite while Rust
 * downloads the FIT file in the background.
 *
 * Expected behaviour: a settled activity is never re-requested, an unsettled one
 * asks Rust once and then waits for the engine to announce the parse, and no
 * engine call is made on a timer while it waits.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useExerciseSets } from '@/features/strength/hooks/useExerciseSets';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const listeners = new Map<string, Set<(payload?: { activityId: string }) => void>>();

const engine = {
  getExerciseSets: jest.fn(),
  isFitProcessed: jest.fn(),
  fetchAndParseExerciseSets: jest.fn(),
  bulkInsertExerciseSets: jest.fn(),
  subscribe: jest.fn((event: string, cb: (payload?: { activityId: string }) => void) => {
    const subscribers = listeners.get(event) ?? new Set<typeof cb>();
    listeners.set(event, subscribers);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }),
};

function announce(activityId: string) {
  listeners.get('fitParsed')?.forEach((cb) => cb({ activityId }));
}

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

const aSet = {
  activityId: 'act1',
  setOrder: 0,
  exerciseCategory: 0,
  exerciseName: 1,
  setType: 0,
  repetitions: 10,
  weightKg: 60,
  durationSecs: null,
  startTime: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getExerciseSets.mockReturnValue([]);
  engine.isFitProcessed.mockReturnValue(false);
  engine.fetchAndParseExerciseSets.mockReturnValue(true);
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
});

afterEach(() => {
  client.clear();
});

it('returns cached sets without asking Rust to download', async () => {
  engine.getExerciseSets.mockReturnValue([aSet]);

  const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
});

it('does not re-download an activity that has already settled', async () => {
  engine.isFitProcessed.mockReturnValue(true);

  const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([]);
  expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
});

it('asks Rust for an unsettled activity and reads back what the parse announces', async () => {
  const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledWith('act1'));
  await waitFor(() => expect(result.current.data).toEqual([]));

  engine.getExerciseSets.mockReturnValue([aSet]);
  act(() => announce('act1'));
  await waitFor(() => expect(result.current.data).toHaveLength(1));
});

it('ignores a parse announced for another activity', async () => {
  const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledWith('act1'));
  const reads = engine.getExerciseSets.mock.calls.length;

  act(() => announce('act2'));
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(engine.getExerciseSets).toHaveBeenCalledTimes(reads);
});

it('makes no engine call between the request and the announcement', async () => {
  jest.useFakeTimers();
  try {
    const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

    await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledWith('act1'));
    const reads = engine.getExerciseSets.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(engine.getExerciseSets).toHaveBeenCalledTimes(reads);
    expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});

it('stops listening once the card unmounts', async () => {
  const { unmount } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() =>
    expect(engine.subscribe).toHaveBeenCalledWith('fitParsed', expect.any(Function))
  );
  unmount();

  expect(listeners.get('fitParsed')?.size ?? 0).toBe(0);
});

it('skips the download entirely for a non-strength activity', async () => {
  const { result } = renderHook(() => useExerciseSets('act1', 'Ride'), { wrapper });

  await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
  expect(engine.getExerciseSets).not.toHaveBeenCalled();
  expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
});
