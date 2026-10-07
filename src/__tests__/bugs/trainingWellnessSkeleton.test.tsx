/**
 * Scenario: the training tab opens on a cold wellness query.
 *
 * Expected behaviour: the trends card holds its final 200 px height from the
 * first paint, so the chart landing moves nothing below it.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TrainingScreen from '@/app/(tabs)/training';
import { Shimmer } from '@/shared/ui';

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('@/features/stats', () => ({
  WeeklySummary: () => null,
  ActivityHeatmap: () => null,
  SeasonComparison: () => null,
}));
jest.mock('@/features/wellness', () => ({
  WellnessTrendsChart: () => null,
  useWellness: () => ({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

it('draws a 200 px shimmer and no spinner in the trends card while loading', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrainingScreen />
    </QueryClientProvider>
  );
  const card = await screen.findByTestId('wellness-trends-chart');

  expect(within(card).UNSAFE_getByType(Shimmer).props.height).toBe(200);
  expect(within(card).UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
});
