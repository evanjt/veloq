/**
 * Scenario: the Strength tab over one engine screen read. The body diagram is
 * stood in for by a button per muscle, since what is under test is what the tab
 * draws once a muscle is chosen, not the hit testing that chooses it.
 *
 * Expected behaviour: a period whose strength sessions are still owed their
 * files says so rather than that none exist; a muscle trained in the period
 * shows its period totals whether or not the last four weeks reached it.
 */

import { SyncState } from 'veloqrs';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StrengthTab } from '@/features/insights/components/StrengthTab';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ data: null }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'strength.periodOwed' ? `${key}:${options?.count}` : key,
  }),
}));

jest.mock('@/features/strength/components/StrengthBodyDiagram', () => {
  const { Pressable, Text } = require('react-native');
  return {
    StrengthBodyDiagram: ({ onMuscleTap }: { onMuscleTap: (slug: string) => void }) => (
      <>
        {['hamstring', 'quadriceps'].map((slug) => (
          <Pressable key={slug} testID={`tap-${slug}`} onPress={() => onMuscleTap(slug)}>
            <Text>{slug}</Text>
          </Pressable>
        ))}
      </>
    ),
  };
});

const engine = {
  subscribe: jest.fn(() => () => {}),
  getSyncStatus: jest.fn(() => ({ state: SyncState.Idle })),
  getStrengthScreenData: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const volume = (slug: string, weightedSets: number) => ({
  slug,
  primarySets: weightedSets,
  secondarySets: 0,
  weightedSets,
  totalReps: weightedSets * 8,
  volumeKg: weightedSets * 400,
  exerciseNames: ['Leg Curl'],
});

const summary = (muscleVolumes: ReturnType<typeof volume>[]) => ({
  muscleVolumes,
  activityCount: muscleVolumes.length > 0 ? 2 : 0,
  totalSets: muscleVolumes.reduce((sum, v) => sum + v.weightedSets, 0),
  balance: [],
});

const legCurl = {
  exerciseName: 'Leg Curl',
  exerciseCategory: 15,
  totalSets: 12,
  volumeKg: 4800,
  activityCount: 2,
  isPrimary: true,
};

/** Hamstrings trained eight weeks ago and quadriceps this month. */
function screenRead(fields: Record<string, unknown> = {}) {
  const weekly = [0, 1, 2, 3].map(() => summary([volume('quadriceps', 2)]));
  return {
    summary: summary([volume('hamstring', 12), volume('quadriceps', 8)]),
    weekly,
    progressions: [
      {
        muscleSlug: 'quadriceps',
        weeklyWeightedSets: [2, 2, 2, 2],
        recentAverage: 2,
        baselineAverage: 2,
        peakWeightedSets: 2,
        changePct: 0,
        trend: 'flat',
      },
    ],
    exercises: [
      { muscleSlug: 'hamstring', exercises: [legCurl] },
      { muscleSlug: 'quadriceps', exercises: [{ ...legCurl, exerciseName: 'Squat' }] },
    ],
    owedCount: 0,
    ...fields,
  };
}

let client: QueryClient;

function renderTab(props: React.ComponentProps<typeof StrengthTab> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <StrengthTab {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getStrengthScreenData.mockReturnValue(screenRead());
  engine.getSyncStatus.mockReturnValue({ state: SyncState.Idle });
});

afterEach(() => {
  client.clear();
});

describe('a period with no parsed sets', () => {
  it('says the workouts are not downloaded when the period still owes some', async () => {
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 3,
      })
    );

    renderTab();

    await waitFor(() => expect(screen.getByText('strength.notDownloaded')).toBeTruthy());
    expect(screen.queryByText('strength.noWorkouts')).toBeNull();
  });

  it('shows a spinner rather than the cloud while a sync is running', async () => {
    engine.getSyncStatus.mockReturnValue({ state: SyncState.Syncing });
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 3,
      })
    );

    renderTab();

    await waitFor(() => expect(screen.getByText('strength.downloading')).toBeTruthy());
    expect(screen.getByTestId('strength-downloading')).toBeTruthy();
    expect(screen.queryByText('strength.notDownloaded')).toBeNull();
  });

  it('says there are no workouts when the period owes none', async () => {
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 0,
      })
    );

    renderTab();

    await waitFor(() => expect(screen.getByText('strength.noWorkouts')).toBeTruthy());
  });
});

describe('a populated period that still owes some workouts', () => {
  it('says how many are not downloaded yet', async () => {
    engine.getStrengthScreenData.mockReturnValue(screenRead({ owedCount: 2 }));

    renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-period-owed')).toBeTruthy());
    expect(screen.getByText('strength.periodOwed:2')).toBeTruthy();
  });

  it('passes a count of one through the same key', async () => {
    engine.getStrengthScreenData.mockReturnValue(screenRead({ owedCount: 1 }));

    renderTab();

    await waitFor(() => expect(screen.getByText('strength.periodOwed:1')).toBeTruthy());
  });

  it('shows no line when the period owes none', async () => {
    renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-tab')).toBeTruthy());
    expect(screen.queryByTestId('strength-period-owed')).toBeNull();
  });

  it('does not repeat the count in an empty period', async () => {
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 3,
      })
    );

    renderTab();

    await waitFor(() => expect(screen.getByText('strength.notDownloaded')).toBeTruthy());
    expect(screen.queryByTestId('strength-period-owed')).toBeNull();
  });
});

describe('a failed strength screen read', () => {
  it('shows the database failure and retries the read', async () => {
    const databaseError = { tag: 'Database', inner: { msg: 'read failed' } };
    engine.getStrengthScreenData.mockImplementationOnce(() => {
      throw databaseError;
    });

    renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-failed')).toBeTruthy());
    expect(screen.getByText('engine.failure.database')).toBeTruthy();
    expect(screen.queryByText('strength.noWorkouts')).toBeNull();

    fireEvent.press(screen.getByText('errorState.tryAgain'));

    await waitFor(() => expect(engine.getStrengthScreenData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('strength-failed')).toBeNull());
    fireEvent.press(screen.getByTestId('tap-hamstring'));
    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
  });
});

describe('a selected muscle', () => {
  it('shows its period totals when the last four weeks never reached it', async () => {
    renderTab();
    fireEvent.press(await screen.findByTestId('tap-hamstring'));

    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('96')).toBeTruthy();
    expect(screen.getByText('strength.totalVolume')).toBeTruthy();
    expect(screen.getByText('Leg Curl')).toBeTruthy();
    // No four-week series to draw, so no bars, badge or averages for it.
    expect(screen.queryByText('strength.last4Weeks')).toBeNull();
    expect(screen.queryByText('strength.recentAvg')).toBeNull();
  });

  it('shows the four-week figures beside the totals when the weeks reached it', async () => {
    renderTab();
    fireEvent.press(await screen.findByTestId('tap-quadriceps'));

    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
    expect(screen.getByText('strength.totalVolume')).toBeTruthy();
    expect(screen.getByText('strength.last4Weeks')).toBeTruthy();
    expect(screen.getByText('strength.recentAvg')).toBeTruthy();
  });

  it('follows the engine peak, not the weekly points, for whether the weeks reached it', async () => {
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        progressions: [
          {
            muscleSlug: 'quadriceps',
            weeklyWeightedSets: [2, 2, 2, 2],
            recentAverage: 2,
            baselineAverage: 2,
            peakWeightedSets: 0,
            changePct: 0,
            trend: 'flat',
          },
        ],
      })
    );
    renderTab();
    fireEvent.press(await screen.findByTestId('tap-quadriceps'));

    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
    expect(screen.queryByText('strength.last4Weeks')).toBeNull();
  });
});
