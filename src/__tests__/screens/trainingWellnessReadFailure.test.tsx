/**
 * Scenario: the wellness read throws while the tab's other cards read their own aggregates.
 *
 * Expected behaviour: the header, the range pills, the heatmap and the weekly summary stay on
 * screen with pull to refresh, and only the wellness card shows the read failure with a Retry.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RefreshControl } from 'react-native';

import TrainingScreen from '@/app/(tabs)/training';

const mockRefetch = jest.fn().mockResolvedValue(undefined);

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
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
jest.mock('@/features/stats', () => {
  const { View } = require('react-native');
  return {
    WeeklySummary: () => <View testID="weekly-summary" />,
    ActivityHeatmap: () => <View testID="activity-heatmap" />,
    SeasonComparison: () => <View testID="season-comparison" />,
  };
});
jest.mock('@/features/wellness', () => {
  const { View } = require('react-native');
  return {
    WellnessTrendsChart: () => <View testID="wellness-chart-canvas" />,
    useWellness: () => ({
      data: undefined,
      error: { tag: 'Database' },
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: mockRefetch,
    }),
    useWellnessCoverage: () => require('veloqrs').RangeCoverage.NotFetched,
  };
});
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: { weeks: [] }, isLoading: false, error: null }),
}));

function renderTraining() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TrainingScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => mockRefetch.mockClear());

describe('training tab with the wellness read failing', () => {
  it('keeps the header, range pills and independent cards and fails inside the wellness card', async () => {
    await renderTraining();
    expect(screen.getByTestId('native-header')).toBeTruthy();
    expect(screen.getByTestId('training-smoothing-button')).toBeTruthy();
    expect(screen.getByTestId('activity-heatmap')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(RefreshControl)).toHaveLength(1);

    await waitFor(() => expect(screen.getByTestId('weekly-summary')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('season-comparison')).toBeTruthy());

    const card = screen.getByTestId('wellness-trends-chart');
    expect(card).toBeTruthy();
    expect(screen.getByTestId('wellness-trends-failed')).toBeTruthy();
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
  });

  it('retries the wellness read from inside the card', async () => {
    await renderTraining();
    await waitFor(() => expect(screen.getByTestId('wellness-trends-failed')).toBeTruthy());
    await fireEvent.press(screen.getByText('common.retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
