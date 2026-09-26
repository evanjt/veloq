/**
 * Scenario: a WeightTraining session whose FIT download failed. A retryable
 * failure records no status row, so the query caches an empty list under
 * `staleTime: Infinity` and the table renders nothing at all, which is exactly
 * what a session logged without sets renders.
 *
 * Expected behaviour: the hook says which of the two it is, and the table says
 * the sets have not been downloaded rather than drawing nothing.
 */

import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useExerciseSets } from '@/features/strength/hooks/useExerciseSets';
import { ExerciseTable } from '@/features/strength/components/ExerciseTable';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

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
});

afterEach(() => {
  client.clear();
});

describe('the exercise sets hook', () => {
  it('says the sets are not downloaded when nothing has settled the activity', async () => {
    const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
  });

  /** A status row is the engine's settled verdict: the session has no sets. */
  it('says the session is genuinely empty once the engine has settled it', async () => {
    engine.isFitProcessed.mockReturnValue(true);

    const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('empty'));
  });

  it('says loaded when there are sets, whatever the status row says', async () => {
    engine.getExerciseSets.mockReturnValue([aSet]);

    const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('loaded'));
  });

  /** A throw out of the engine is ignorance, not an empty session. */
  it('says pending when the engine read threw', async () => {
    engine.getExerciseSets.mockImplementation(() => {
      throw new Error('ffi');
    });

    const { result } = renderHook(() => useExerciseSets('act1', 'WeightTraining'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
  });

  /** Not a strength activity at all: the hook is disabled and claims nothing. */
  it('says nothing for an activity that carries no FIT file', async () => {
    const { result } = renderHook(() => useExerciseSets('act1', 'Ride'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
    expect(engine.getExerciseSets).not.toHaveBeenCalled();
  });
});

describe('the exercise table with no sets', () => {
  it('says they have not been downloaded when the activity has not settled', async () => {
    render(<ExerciseTable activityId="act1" activityType="WeightTraining" isDark={false} />, {
      wrapper,
    });

    await waitFor(() => expect(screen.getByText('strength.setsNotDownloaded')).toBeTruthy());
  });

  it('draws nothing for a session the engine settled as set-free', async () => {
    engine.isFitProcessed.mockReturnValue(true);

    const tree = render(
      <ExerciseTable activityId="act1" activityType="WeightTraining" isDark={false} />,
      { wrapper }
    );

    await waitFor(() => expect(tree.toJSON()).toBeNull());
  });
});
