/**
 * Scenario: a WeightTraining card reads its sets from SQLite while Rust
 * downloads the FIT file in the background.
 *
 * Expected behaviour: a settled activity is never re-requested, an unsettled one
 * asks Rust once and reads back what lands, and a download that never settles
 * stops polling rather than running a timer for as long as the screen is open.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useExerciseSets } from '@/features/strength/hooks/useExerciseSets';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getExerciseSets: jest.fn(),
  isFitProcessed: jest.fn(),
  fetchAndParseExerciseSets: jest.fn(),
  bulkInsertExerciseSets: jest.fn(),
};

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

it('asks Rust for an unsettled activity and reads back what lands', async () => {
  const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

  await waitFor(() => expect(engine.fetchAndParseExerciseSets).toHaveBeenCalledWith('act1'));
  await waitFor(() => expect(result.current.data).toEqual([]));

  // The background download finishes and the next poll reads the stored sets.
  engine.getExerciseSets.mockReturnValue([aSet]);
  await waitFor(() => expect(result.current.data).toHaveLength(1), { timeout: 5000 });
});

it('skips the download entirely for a non-strength activity', async () => {
  const { result } = renderHook(() => useExerciseSets('act1', 'Ride'), { wrapper });

  await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
  expect(engine.getExerciseSets).not.toHaveBeenCalled();
  expect(engine.fetchAndParseExerciseSets).not.toHaveBeenCalled();
});
