/**
 * Scenario: the fitness tab's calendar card mounts with its read already
 * cached, so it has its data on the first commit.
 *
 * Expected behaviour: until the screen's stage for its canvas, the card paints
 * its count and a placeholder the size of the grid with no Skia canvas in it,
 * so the canvas landing moves nothing; on that stage the grid is drawn.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type FitnessScreenWindows } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { HEATMAP_PITCH, HEATMAP_WEEKS } from '@/features/stats/lib/heatmapGrid';
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

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

it('paints the count and a grid-sized placeholder before its canvas, then draws the grid', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const card = (drawn: boolean) => (
    <QueryClientProvider client={client}>
      <WithScreenRead>
        {(training) => <ActivityHeatmap training={training} drawn={drawn} />}
      </WithScreenRead>
    </QueryClientProvider>
  );

  // Warm the screen read, as an earlier mount or another card would have.
  const warm = await render(card(true));
  await waitFor(() => expect(screen.getByTestId('activity-heatmap-count')).toBeTruthy());
  await warm.unmount();

  const view = await render(card(false));
  expect(screen.getByTestId('activity-heatmap-count')).toBeTruthy();
  const placeholder = StyleSheet.flatten(
    screen.getByTestId('activity-heatmap-placeholder').props.style
  );
  expect(placeholder.width).toBe(HEATMAP_WEEKS * HEATMAP_PITCH);
  expect(placeholder.height).toBe(7 * HEATMAP_PITCH);
  expect(screen.queryAllByTestId('skia-canvas')).toHaveLength(0);

  await view.rerender(card(true));
  expect(screen.queryAllByTestId('skia-canvas')).toHaveLength(1);
  expect(screen.queryByTestId('activity-heatmap-placeholder')).toBeNull();
});
