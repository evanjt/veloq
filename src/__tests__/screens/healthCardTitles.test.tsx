/**
 * Scenario: the Health tab's four cards each drew their own title, at three
 * sizes and two weights, and none of them was a heading.
 *
 * Expected behaviour: every card title on the tab is a header in one size and
 * one weight, so peer cards read as peers and a screen reader can skim them.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type TrainingScreenWindows } from 'veloqrs';

import TrainingScreen from '@/app/(tabs)/training';
import { i18n, initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { TIME_RANGES } from '@/shared/app/constants';
import { noComparisons } from '../__shared__/trainingScreenRead';
import { typography } from '@/theme';

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
  WellnessTrendsChart: () => null,
  useWellnessCoverage: () => require('veloqrs').RangeCoverage.Loaded,
  useWellness: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
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
  getTrainingScreenData: jest.fn((windows: TrainingScreenWindows) => ({
    heatmap: [],
    months: [],
    yearCurrent: totals(0, 0),
    yearPrevious: totals(0, 0),
    monthCurrent: totals(0, 0),
    monthPrevious: totals(0, 0),
    comparisons: noComparisons(windows.nowWallSeconds),
  })),
  getActivityBodies: jest.fn(() => []),
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

describe('Health tab card titles', () => {
  it('draws every card title as a header in one size and weight', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <TrainingScreen />
      </QueryClientProvider>
    );
    const titles = [
      i18n.t('stats.activityCalendar'),
      i18n.t('wellnessScreen.trends'),
      i18n.t('stats.seasonComparison'),
    ];
    // The weekly and season cards mount a frame or two after the screen.
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

/**
 * Scenario: the range toggles and the smoothing button drive only the wellness
 * chart, yet sat in a row of their own directly under the activity calendar.
 *
 * Expected behaviour: the controls sit inside the wellness card they drive.
 */
describe('Health tab wellness range controls', () => {
  it('draws the range toggles and the smoothing button inside the wellness card', () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <TrainingScreen />
      </QueryClientProvider>
    );
    const card = within(screen.getByTestId('wellness-trends-chart'));

    expect(card.getByTestId('training-smoothing-button')).toBeTruthy();
    for (const range of TIME_RANGES) {
      expect(card.getByText(i18n.t(range.labelKey as never))).toBeTruthy();
    }
  });
});
