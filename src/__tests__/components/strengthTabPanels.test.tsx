/**
 * Scenario: the Strength tab over one engine screen read. The body diagram is
 * stood in for by a button per muscle, since what is under test is what the tab
 * draws once a muscle is chosen, not the hit testing that chooses it.
 *
 * Expected behaviour: a period whose strength sessions are still owed their
 * files says so rather than that none exist, asks for the files, and says what
 * will fix a request the engine refused; a muscle trained in the period shows
 * its period totals whether or not the last four weeks reached it.
 */

import { StartOutcome, SyncState } from 'veloqrs';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StrengthTab } from '@/features/insights/components/StrengthTab';
import { getEngine, getNativeModule } from '@/shared/native/engine';
import { BODY_WAIT_MS } from '@/shared/native/engineBodies';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  getNativeModule: jest.fn(),
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

const mockDiagramProps: { bodyData?: unknown; maxWeightedSets?: number } = {};

jest.mock('@/features/strength/components/StrengthBodyDiagram', () => {
  const { Pressable, Text } = require('react-native');
  return {
    StrengthBodyDiagram: ({
      onMuscleTap,
      bodyData,
      maxWeightedSets,
    }: {
      onMuscleTap: (slug: string) => void;
      bodyData: unknown;
      maxWeightedSets: number;
    }) => {
      Object.assign(mockDiagramProps, { bodyData, maxWeightedSets });
      return (
        <>
          {['hamstring', 'quadriceps'].map((slug) => (
            <Pressable key={slug} testID={`tap-${slug}`} onPress={() => onMuscleTap(slug)}>
              <Text>{slug}</Text>
            </Pressable>
          ))}
        </>
      );
    },
  };
});

const engine = {
  subscribe: jest.fn(() => () => {}),
  getSyncStatus: jest.fn(() => ({ state: SyncState.Idle })),
  getStrengthScreenData: jest.fn(),
  getUnprocessedStrengthIds: jest.fn((): string[] => []),
  batchFetchExerciseSets: jest.fn((_ids: string[]) => ({ outcome: StartOutcome.NotOwed })),
  getBodiesStored: jest.fn(() => 0),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const volume = (slug: string, weightedSets: number, shade = 1) => ({
  slug,
  primarySets: weightedSets,
  secondarySets: 0,
  weightedSets,
  totalReps: weightedSets * 8,
  volumeKg: weightedSets * 400,
  exerciseNames: ['Leg Curl'],
  shade,
});

const summary = (muscleVolumes: ReturnType<typeof volume>[]) => ({
  muscleVolumes,
  activityCount: muscleVolumes.length > 0 ? 2 : 0,
  totalSets: muscleVolumes.reduce((sum, v) => sum + v.weightedSets, 0),
  maxWeightedSets: Math.max(0, ...muscleVolumes.map((v) => v.weightedSets)),
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
    summary: summary([volume('hamstring', 12, 5), volume('quadriceps', 8, 4)]),
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
  (getNativeModule as jest.Mock).mockReturnValue({ engine });
  engine.getStrengthScreenData.mockReturnValue(screenRead());
  engine.getSyncStatus.mockReturnValue({ state: SyncState.Idle });
  engine.getUnprocessedStrengthIds.mockReturnValue([]);
  engine.batchFetchExerciseSets.mockReturnValue({ outcome: StartOutcome.NotOwed });
});

afterEach(() => {
  client.clear();
});

/** Three strength sessions owe their files, and asking for them answers `outcome`. */
function owesFiles(outcome: StartOutcome) {
  engine.getUnprocessedStrengthIds.mockReturnValue(['w1', 'w2', 'w3']);
  engine.batchFetchExerciseSets.mockReturnValue({ outcome });
}

function emptyPeriodOwing() {
  engine.getStrengthScreenData.mockReturnValue(
    screenRead({
      summary: summary([]),
      weekly: [],
      progressions: [],
      exercises: [],
      owedCount: 3,
    })
  );
}

describe('an empty period whose workouts are owed their files', () => {
  afterEach(() => jest.useRealTimers());

  it('asks for the files online, and offers a Retry once the wait runs out', async () => {
    jest.useFakeTimers();
    owesFiles(StartOutcome.Started);
    emptyPeriodOwing();

    await renderTab();

    await waitFor(() => expect(screen.getByText('strength.downloading')).toBeTruthy());
    expect(engine.batchFetchExerciseSets).toHaveBeenCalledWith(['w1', 'w2', 'w3']);
    expect(screen.queryByTestId('strength-not-downloaded-retry')).toBeNull();

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });

    expect(screen.getByText('strength.notDownloaded')).toBeTruthy();
    expect(screen.queryByText('strength.notDownloadedHint')).toBeNull();
    await fireEvent.press(screen.getByTestId('strength-not-downloaded-retry'));
    expect(engine.batchFetchExerciseSets).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['offline', StartOutcome.Offline, 'refresh.offline'],
    ['signed out', StartOutcome.NotConfigured, 'settings.streamBackfillRefusedNotConfigured'],
  ])('says what fixes a request refused %s, with no Retry', async (_state, outcome, reason) => {
    owesFiles(outcome);
    emptyPeriodOwing();

    await renderTab();

    await waitFor(() => expect(screen.getByText(reason)).toBeTruthy());
    expect(screen.getByText('strength.notDownloaded')).toBeTruthy();
    expect(screen.queryByText('strength.notDownloadedHint')).toBeNull();
    expect(screen.queryByTestId('strength-not-downloaded-retry')).toBeNull();
    expect(screen.queryByTestId('strength-downloading')).toBeNull();
  });

  it('asks for nothing when the period owes no files', async () => {
    await renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-tab')).toBeTruthy());
    expect(engine.batchFetchExerciseSets).not.toHaveBeenCalled();
  });
});

describe('a period with no parsed sets', () => {
  it('says the workouts are not downloaded when the period still owes some', async () => {
    owesFiles(StartOutcome.Offline);
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 3,
      })
    );

    await renderTab();

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

    await renderTab();

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

    await renderTab();

    await waitFor(() => expect(screen.getByText('strength.noWorkouts')).toBeTruthy());
  });
});

describe('a populated period that still owes some workouts', () => {
  it('says how many are not downloaded yet', async () => {
    engine.getStrengthScreenData.mockReturnValue(screenRead({ owedCount: 2 }));

    await renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-period-owed')).toBeTruthy());
    expect(screen.getByText('strength.periodOwed:2')).toBeTruthy();
  });

  it('passes a count of one through the same key', async () => {
    engine.getStrengthScreenData.mockReturnValue(screenRead({ owedCount: 1 }));

    await renderTab();

    await waitFor(() => expect(screen.getByText('strength.periodOwed:1')).toBeTruthy());
  });

  it('shows no line when the period owes none', async () => {
    await renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-tab')).toBeTruthy());
    expect(screen.queryByTestId('strength-period-owed')).toBeNull();
  });

  it('does not repeat the count in an empty period', async () => {
    owesFiles(StartOutcome.Offline);
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: summary([]),
        weekly: [],
        progressions: [],
        exercises: [],
        owedCount: 3,
      })
    );

    await renderTab();

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

    await renderTab();

    await waitFor(() => expect(screen.getByTestId('strength-failed')).toBeTruthy());
    expect(screen.getByText('engine.failure.database')).toBeTruthy();
    expect(screen.queryByText('strength.noWorkouts')).toBeNull();

    await fireEvent.press(screen.getByText('common.retry'));

    await waitFor(() => expect(engine.getStrengthScreenData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('strength-failed')).toBeNull());
    await fireEvent.press(screen.getByTestId('tap-hamstring'));
    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
  });
});

describe('a selected muscle', () => {
  it('shows its period totals when the last four weeks never reached it', async () => {
    await renderTab();
    await fireEvent.press(await screen.findByTestId('tap-hamstring'));

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
    await renderTab();
    await fireEvent.press(await screen.findByTestId('tap-quadriceps'));

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
    await renderTab();
    await fireEvent.press(await screen.findByTestId('tap-quadriceps'));

    expect(screen.getByTestId('strength-progression-card')).toBeTruthy();
    expect(screen.queryByText('strength.last4Weeks')).toBeNull();
  });
});

describe('a period named by a link', () => {
  /** The span in days of the period the last strength read asked for. */
  function lastReadDays(): number {
    const [startTs, endTs] = engine.getStrengthScreenData.mock.calls.at(-1) as [number, number];
    return Math.round((endTs - startTs) / 86_400);
  }

  function selected(id: string): boolean {
    return !!screen.getByTestId(`strength-period-${id}`).props.accessibilityState?.selected;
  }

  it('opens on the linked period and reads its range, never the default', async () => {
    await renderTab({ linkedPeriod: { period: '1m' } });

    await waitFor(() => expect(engine.getStrengthScreenData).toHaveBeenCalled());
    expect(selected('1m')).toBe(true);
    expect(selected('6m')).toBe(false);
    expect(lastReadDays()).toBe(30);
    for (const [startTs, endTs] of engine.getStrengthScreenData.mock.calls) {
      expect(Math.round((endTs - startTs) / 86_400)).toBe(30);
    }
  });

  it('opens on the default period with no link', async () => {
    await renderTab();

    await waitFor(() => expect(engine.getStrengthScreenData).toHaveBeenCalled());
    expect(selected('6m')).toBe(true);
    expect(lastReadDays()).toBe(180);
  });

  it('moves to the period a second link names while mounted', async () => {
    const { rerender } = await renderTab({ linkedPeriod: { period: '1m' } });
    await waitFor(() => expect(selected('1m')).toBe(true));

    await rerender(
      <QueryClientProvider client={client}>
        <StrengthTab linkedPeriod={{ period: '7d' }} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(selected('7d')).toBe(true));
    expect(lastReadDays()).toBe(7);
  });

  it('keeps the athlete choice until a new link arrives, then follows the link', async () => {
    const link = { period: '1m' as const };
    const { rerender } = await renderTab({ linkedPeriod: link });
    await waitFor(() => expect(selected('1m')).toBe(true));

    await fireEvent.press(screen.getByTestId('strength-period-3m'));
    await rerender(
      <QueryClientProvider client={client}>
        <StrengthTab linkedPeriod={link} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(selected('3m')).toBe(true));

    await rerender(
      <QueryClientProvider client={client}>
        <StrengthTab linkedPeriod={{ period: '1m' }} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(selected('1m')).toBe(true));
  });
});

describe('the body diagram', () => {
  it('draws the shades and the scale top the engine read carries', async () => {
    engine.getStrengthScreenData.mockReturnValue(
      screenRead({
        summary: {
          ...summary([volume('hamstring', 12, 2), volume('quadriceps', 8, 1)]),
          maxWeightedSets: 30,
        },
      })
    );
    await renderTab();

    await waitFor(() =>
      expect(mockDiagramProps.bodyData).toEqual([
        { slug: 'hamstring', intensity: 2 },
        { slug: 'quadriceps', intensity: 1 },
      ])
    );
    expect(mockDiagramProps.maxWeightedSets).toBe(30);
  });
});

describe('the explanation card', () => {
  it('closes a period with workouts, saying how sets count and where they come from', async () => {
    await renderTab();

    const card = await screen.findByTestId('strength-explanation');
    expect(within(card).getByText('insights.explanation.strengthTitle')).toBeTruthy();
    expect(within(card).getByText('strength.infoWeighting')).toBeTruthy();
    expect(within(card).getByText(/strength\.disclaimer$/)).toBeTruthy();
  });
});
