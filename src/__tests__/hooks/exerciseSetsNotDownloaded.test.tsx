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
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useExerciseSets } from '@/features/strength/hooks/useExerciseSets';
import { ExerciseTable } from '@/features/strength/components/ExerciseTable';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
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

const aSet = {
  activityId: 'act1',
  setOrder: 0,
  exerciseCategory: 0,
  exerciseName: 1,
  displayName: 'Engine Squat',
  setType: 0,
  repetitions: 10,
  weightKg: 60,
};

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
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getExerciseSets.mockReturnValue(sessionOf([]));
  engine.isFitProcessed.mockReturnValue(false);
  engine.fetchAndParseExerciseSets.mockReturnValue(true);
});

afterEach(() => {
  client.clear();
});

describe('the exercise sets hook', () => {
  it('says the sets are not downloaded when nothing has settled the activity', async () => {
    const { result } = await renderHook(() => useExerciseSets('act1', 'WeightTraining'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
  });

  /** A status row is the engine's settled verdict: the session has no sets. */
  it('says the session is genuinely empty once the engine has settled it', async () => {
    engine.isFitProcessed.mockReturnValue(true);

    const { result } = await renderHook(() => useExerciseSets('act1', 'WeightTraining'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.outcome).toBe('empty'));
  });

  it('says loaded when there are sets, whatever the status row says', async () => {
    engine.getExerciseSets.mockReturnValue(sessionOf([aSet]));

    const { result } = await renderHook(() => useExerciseSets('act1', 'WeightTraining'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.outcome).toBe('loaded'));
  });

  /** A throw out of the engine is ignorance, not an empty session. */
  it('says pending when the engine read threw', async () => {
    engine.getExerciseSets.mockImplementation(() => {
      throw new Error('ffi');
    });

    const { result } = await renderHook(() => useExerciseSets('act1', 'WeightTraining'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
  });

  /** Not a strength activity at all: the hook is disabled and claims nothing. */
  it('says nothing for an activity that carries no FIT file', async () => {
    const { result } = await renderHook(() => useExerciseSets('act1', 'Ride'), { wrapper });

    await waitFor(() => expect(result.current.outcome).toBe('pending'));
    expect(engine.getExerciseSets).not.toHaveBeenCalled();
  });
});

describe('the exercise table with no sets', () => {
  it('says they have not been downloaded when the activity has not settled', async () => {
    await render(<ExerciseTable activityId="act1" activityType="WeightTraining" isDark={false} />, {
      wrapper,
    });

    await waitFor(() => expect(screen.getByText('strength.setsNotDownloaded')).toBeTruthy());
  });

  it('draws nothing for a session the engine settled as set-free', async () => {
    engine.isFitProcessed.mockReturnValue(true);

    const tree = await render(
      <ExerciseTable activityId="act1" activityType="WeightTraining" isDark={false} />,
      { wrapper }
    );

    await waitFor(() => expect(tree.toJSON()).toBeNull());
  });
});

describe('the exercise table with sets', () => {
  /**
   * Expected behaviour: the totals row and the exercise count show the
   * engine's session figures, whatever the raw sets would sum to here.
   */
  it('shows the engine session totals and groups', async () => {
    engine.getExerciseSets.mockReturnValue({
      sets: [aSet],
      groups: [
        {
          name: 'Engine Squat',
          exerciseCategory: 0,
          sets: [aSet],
          restSeconds: [60],
          bestSet: aSet,
        },
      ],
      activeSetCount: 7,
      exerciseCount: 1,
      totalVolumeKg: 4321,
      totalDurationSecs: 0,
    });

    await render(
      <ExerciseTable
        activityId="act1"
        activityType="WeightTraining"
        isDark={false}
        exerciseGroups={[
          {
            name: 'Engine Squat',
            exerciseCategory: 0,
            sets: [{ ...aSet, weightKg: 70 }],
            bestSet: { ...aSet, weightKg: 70 },
            restSeconds: [180],
          },
        ]}
      />,
      { wrapper }
    );

    await waitFor(() => expect(screen.getByText('Engine Squat')).toBeTruthy());
    expect(screen.getByText('9,526.2 lbs')).toBeTruthy();
    expect(screen.getByText(/strength.bestSet/)).toBeTruthy();
    expect(screen.getByText(/strength.restBetweenSets: 1:00/)).toBeTruthy();
    expect(screen.queryByText(/strength.restBetweenSets: 3:00/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'strength.history' }));
    expect(mockRouterPush).toHaveBeenCalledWith('/exercise/0');
  });
});

describe('the exercise table with a body-weight exercise', () => {
  /**
   * Expected behaviour: a set logged with repetitions and no load reads as its
   * repetitions alone. The engine sends no weight, so no weight is printed, and
   * a missing cell in the set rows is the absent mark rather than a zero.
   */
  it('prints the best set as its repetitions, with no invented zero load', async () => {
    const pushUp = { ...aSet, displayName: 'Engine Push-up', weightKg: undefined, repetitions: 12 };
    engine.getExerciseSets.mockReturnValue({
      sets: [pushUp],
      groups: [
        {
          name: 'Engine Push-up',
          exerciseCategory: 0,
          sets: [pushUp],
          restSeconds: [],
          bestSet: pushUp,
        },
      ],
      activeSetCount: 1,
      exerciseCount: 1,
      totalVolumeKg: 0,
      totalDurationSecs: 0,
    });

    await render(<ExerciseTable activityId="act1" activityType="WeightTraining" isDark={false} />, {
      wrapper,
    });

    await waitFor(() => expect(screen.getByText('Engine Push-up')).toBeTruthy());
    const bestSet = screen.getByText(/strength.bestSet/);
    expect(bestSet).toHaveTextContent('strength.bestSet: strength.repsCount');
    expect(screen.queryByText(/0 kg/)).toBeNull();
    expect(screen.queryByText(/0 lbs/)).toBeNull();
    const absent = screen.getAllByLabelText('common.noData');
    expect(absent.length).toBeGreaterThanOrEqual(2);
    absent.forEach((cell) => expect(cell).toHaveTextContent('--'));
  });
});
