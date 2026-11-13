/**
 * Scenario: the wellness, weekly, calendar and year comparison cards each drew
 * their own title, at three sizes and two weights, and none of them was a
 * heading.
 *
 * Expected behaviour: every one of those card titles on the fitness tab is a
 * header in one size and one weight, so peer cards read as peers and a screen
 * reader can skim them.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type FitnessScreenWindows } from 'veloqrs';

import { WellnessTrendsCard } from '@/features/fitness';
import { ActivityHeatmap, SeasonComparison, WeeklySummary } from '@/features/stats';
import { Card } from '@/shared/ui';
import { i18n, initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import {
  NO_FITNESS_PARTS,
  noComparisons,
  summaryComparison,
} from '../__shared__/fitnessScreenRead';
import { typography } from '@/theme';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('@/features/wellness', () => ({
  ...jest.requireActual('@/features/wellness'),
  WellnessTrendsChart: () => null,
}));
jest.mock('@/features/fitness/hooks', () => ({
  ...jest.requireActual('@/features/fitness/hooks'),
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

const totals = (count: number, hours: number) => ({
  count,
  totalDuration: hours * 3600,
  totalDistance: count * 10_000,
  totalTss: count * 50,
});

const engine = {
  subscribe: jest.fn(() => () => {}),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  getFitnessScreenData: jest.fn((_spanDays: number[], windows: FitnessScreenWindows) => ({
    ...NO_FITNESS_PARTS,
    heatmap: [],
    months: [],
    seasonYear: summaryComparison(windows.nowWallSeconds, {
      currentStats: totals(0, 0),
      previousStats: totals(0, 0),
    }),
    seasonMonths: [
      summaryComparison(windows.nowWallSeconds, {
        currentStats: totals(0, 0),
        previousStats: totals(0, 0),
      }),
    ],
    comparisons: noComparisons(windows.nowWallSeconds),
  })),
  getFeedCards: jest.fn(() => []),
};

let client: QueryClient;

afterEach(() => {
  client.clear();
});

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

const flat = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) ?? {};

/** The four cards as the fitness tab draws them. */
function FitnessCards() {
  return (
    <>
      <WellnessTrendsCard
        wellness={[]}
        coverage={RangeCoverage.Loaded}
        timeRange="3m"
        drawn
        isLoading={false}
        held={false}
        readError={undefined}
        onRetry={jest.fn()}
        onDateSelect={jest.fn()}
      />
      <Card variant="flat">
        <WithScreenRead>{(training) => <WeeklySummary training={training} />}</WithScreenRead>
      </Card>
      <Card variant="flat">
        <WithScreenRead>
          {(training) => <ActivityHeatmap training={training} drawn />}
        </WithScreenRead>
      </Card>
      <Card variant="flat">
        <WithScreenRead>
          {(training) => <SeasonComparison training={training} height={180} />}
        </WithScreenRead>
      </Card>
    </>
  );
}

describe('fitness tab card titles', () => {
  it('draws every card title as a header in one size and weight', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <FitnessCards />
      </QueryClientProvider>
    );
    const titles = [
      i18n.t('stats.activityCalendar'),
      i18n.t('wellnessScreen.trends'),
      i18n.t('stats.seasonComparison'),
    ];
    await waitFor(() => expect(screen.getByTestId('weekly-summary')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(titles[2])).toBeTruthy());

    // The weekly card is titled by the period it shows, so it is found by its card.
    const headers = [
      ...titles.map((name) => screen.getByRole('header', { name })),
      within(screen.getByTestId('weekly-summary')).getByRole('header'),
    ];

    for (const header of headers) {
      const style = flat(header);
      expect(style.fontSize).toBe(typography.cardTitle.fontSize);
      expect(style.fontWeight).toBe(typography.cardTitle.fontWeight);
    }
  });
});
