/**
 * Scenario: the Health tab header sits beside the Fitness header.
 *
 * Expected behaviour: the title leads the row at the screen padding, with no
 * fixed-width boxes around it.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TrainingScreen from '@/app/(tabs)/training';
import { layout } from '@/theme';

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
    isFetching: true,
    isError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

it('leads the header with the title at the screen padding and no fixed boxes', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrainingScreen />
    </QueryClientProvider>
  );
  const header = await screen.findByTestId('training-header');
  const style = StyleSheet.flatten(header.props.style);

  expect(style.paddingHorizontal).toBe(layout.screenPadding);
  const children = React.Children.toArray(header.props.children);
  const widths = header.findAll((n) => StyleSheet.flatten(n.props.style)?.width === 48);
  expect(widths).toHaveLength(0);
  expect(children.length).toBeGreaterThan(0);
});
