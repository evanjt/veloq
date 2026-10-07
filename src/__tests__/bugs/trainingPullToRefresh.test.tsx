/**
 * Scenario: the athlete pulls down on the training tab.
 *
 * Expected behaviour: the tab asks the engine for a sync, not only for a
 * re-read of the local database.
 */

import React from 'react';
import { RefreshControl } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TrainingScreen from '@/app/(tabs)/training';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

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
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

it('asks the engine for a sync when the training tab is pulled', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrainingScreen />
    </QueryClientProvider>
  );
  await screen.findByTestId('training-screen');
  const control = screen.UNSAFE_getByType(RefreshControl);

  await act(async () => {
    await control.props.onRefresh();
  });

  expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
});
