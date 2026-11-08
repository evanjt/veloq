/**
 * Scenario: the calendar grid sits on a tab pager's page and scrolls sideways,
 * and a sideways pan on it paged the tabs instead of scrolling the grid.
 *
 * Expected behaviour: the pager's pan waits for the grid's own gesture to fail,
 * so a pan that starts on the grid scrolls it, and only while the grid is mounted.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type FitnessScreenWindows } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { Gesture } from 'react-native-gesture-handler';
import { SwipeableTabs } from '@/shared/ui';
import { initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import {
  NO_FITNESS_PARTS,
  noComparisons,
  summaryComparison,
} from '../__shared__/fitnessScreenRead';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');

const totals = { count: 2, totalDuration: 7200, totalDistance: 20_000, totalTss: 100 };

const engine = {
  subscribe: () => () => {},
  rangeCoverage: () => RangeCoverage.Loaded,
  getFitnessScreenData: (_spanDays: number[], windows: FitnessScreenWindows) => ({
    ...NO_FITNESS_PARTS,
    heatmap: [{ date: windows.heatmapLastDay, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    months: [],
    seasonYear: summaryComparison(windows.nowWallSeconds, {
      currentStats: totals,
      previousStats: totals,
    }),
    seasonMonths: [
      summaryComparison(windows.nowWallSeconds, { currentStats: totals, previousStats: totals }),
    ],
    comparisons: noComparisons(windows.nowWallSeconds),
  }),
};

type Pan = ReturnType<typeof Gesture.Pan>;
type Native = ReturnType<typeof Gesture.Native>;

const TABS = [
  { key: 'calendar', label: 'Calendar', icon: 'calendar' as const },
  { key: 'other', label: 'Other', icon: 'note-text-outline' as const },
];

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

afterEach(() => jest.restoreAllMocks());

it('makes the pager wait for the calendar grid before it pages', async () => {
  const pans: Pan[] = [];
  const natives: Native[] = [];
  const realPan = Gesture.Pan.bind(Gesture);
  const realNative = Gesture.Native.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = realPan();
    pans.push(gesture);
    return gesture;
  });
  jest.spyOn(Gesture, 'Native').mockImplementation(() => {
    const gesture = realNative();
    natives.push(gesture);
    return gesture;
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <WithScreenRead>
        {(training) => (
          <SwipeableTabs tabs={TABS} activeTab="calendar" onTabChange={jest.fn()} isDark={false}>
            <ActivityHeatmap training={training} drawn />
            <React.Fragment />
          </SwipeableTabs>
        )}
      </WithScreenRead>
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByTestId('activity-heatmap-scroll')).toBeTruthy());

  const grid = natives[natives.length - 1];
  expect(grid).toBeDefined();
  expect(pans[pans.length - 1]!.config.requireToFail ?? []).toContain(grid);
});
