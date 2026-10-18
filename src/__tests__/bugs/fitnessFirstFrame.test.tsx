/**
 * Scenario: the fitness tab also holds the wellness trends, the weekly
 * summary, the activity calendar and the year comparison.
 *
 * Expected behaviour: the first visit paints the range selector and a chart
 * placeholder before mounting chart canvases and lower sections, so the cards
 * it holds leave the first frame as it was; they mount with the sections below
 * the fold, in order under the fitness chart, and their canvases follow one
 * per frame.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';

import FitnessScreen from '@/app/(tabs)/fitness';

jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => jest.fn(),
  logMemory: jest.fn(),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  router: { setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  ScrollView: require('react-native').ScrollView,
}));
jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    Card: jest.requireActual('@/shared/ui/Card').Card,
    ScreenSafeAreaView: View,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
    ChartSkeleton: View,
    ErrorState: View,
  };
});
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useCollapsibleSections: () => ({
    expanded: () => false,
    onToggle: () => jest.fn(),
    setExpanded: jest.fn(),
  }),
}));
jest.mock('@/shared/app/useRevealChart', () => ({
  useRevealChart: () => ({
    scrollRef: { current: null },
    onAnchorLayout: jest.fn(),
    onScrollBeginDrag: jest.fn(),
  }),
}));
jest.mock('@/features/wellness', () => ({ timeRangeToDays: () => 90 }));
jest.mock('@/features/stats', () => {
  const { View } = require('react-native');
  return {
    ActivityHeatmap: ({ drawn }: { drawn: boolean }) => (
      <View testID={drawn ? 'activity-heatmap-canvas' : 'activity-heatmap-placeholder'} />
    ),
    WeeklySummary: () => <View testID="weekly-summary" />,
    SeasonComparison: () => <View testID="season-comparison" />,
  };
});
jest.mock('@/features/fitness', () => {
  const { View } = require('react-native');
  return {
    FitnessChartCard: () => <View testID="fitness-chart-canvas" />,
    PerformanceCurveSection: () => <View testID="performance-curves" />,
    FitnessTrendSections: () => <View testID="fitness-trends" />,
    FitnessDefinitionsCard: View,
    WellnessTrendsCard: ({ drawn }: { drawn: boolean }) => (
      <View testID={drawn ? 'wellness-chart-canvas' : 'wellness-chart-shimmer'} />
    ),
    TimeRangeSelector: () => <View testID="time-range" />,
    SportToggleSelector: () => <View testID="sport-toggle" />,
    BestEffortsHeaderButton: () => null,
    resolveThresholdPace: () => null,
    useFitnessRefresh: () => ({ isRefreshing: false, onRefresh: jest.fn() }),
    useFitnessComputations: () => ({ ftpTrend: [], dominantZone: null }),
    useFitnessScreenData: () => ({
      wellness: [],
      activities: [],
      dailyLoads: [],
      eftpChanges: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    }),
    useFitnessWindow: () => ({
      timeRange: '3m',
      changeTimeRange: jest.fn(),
      sharedSelectedIdx: { value: -1 },
      chartInteracting: false,
      selectedDate: null,
      selectedValues: null,
      handleInteractionChange: jest.fn(),
      handleDateSelect: jest.fn(),
    }),
    useSportPreference: () => ({ primarySport: 'Cycling', adoptLibrarySport: jest.fn() }),
    FORM_ZONE_COLORS: { optimal: 'green' },
  };
});

it('paints the range selector and a chart placeholder before mounting the chart and performance section', async () => {
  const frames: FrameRequestCallback[] = [];
  const request = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());

  try {
    await render(<FitnessScreen />);
    expect(screen.getByTestId('time-range')).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByTestId('fitness-chart-placeholder').props.style).height
    ).toBe(500);
    expect(screen.queryByTestId('fitness-chart-canvas')).toBeNull();
    expect(screen.queryByTestId('performance-curves')).toBeNull();
    expect(screen.queryByTestId('fitness-trends')).toBeNull();

    await act(() => frames.shift()?.(0));
    expect(screen.queryByTestId('fitness-chart-canvas')).toBeNull();

    await act(() => frames.shift()?.(16));
    expect(screen.getByTestId('fitness-chart-canvas')).toBeTruthy();
    expect(screen.queryByTestId('fitness-chart-placeholder')).toBeNull();
    expect(screen.queryByTestId('performance-curves')).toBeNull();

    await act(() => frames.shift()?.(32));
    expect(screen.getByTestId('performance-curves')).toBeTruthy();
    expect(screen.getByTestId('fitness-trends')).toBeTruthy();
    expect(screen.getByTestId('wellness-chart-shimmer')).toBeTruthy();
    expect(screen.getByTestId('activity-heatmap-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('weekly-summary')).toBeNull();
    expect(screen.queryByTestId('season-comparison')).toBeNull();

    await act(() => frames.shift()?.(48));
    expect(screen.getByTestId('wellness-chart-canvas')).toBeTruthy();
    expect(screen.getByTestId('activity-heatmap-placeholder')).toBeTruthy();

    await act(() => frames.shift()?.(64));
    expect(screen.getByTestId('activity-heatmap-canvas')).toBeTruthy();
    expect(screen.queryByTestId('weekly-summary')).toBeNull();

    await act(() => frames.shift()?.(80));
    expect(screen.getByTestId('weekly-summary')).toBeTruthy();
    expect(screen.queryByTestId('season-comparison')).toBeNull();

    await act(() => frames.shift()?.(96));
    expect(screen.getByTestId('season-comparison')).toBeTruthy();
    expect(frames).toHaveLength(0);

    const order = [
      'fitness-chart-canvas',
      'wellness-trends-chart',
      'weekly-summary',
      'activity-heatmap-canvas',
      'season-comparison',
      'sport-toggle',
      'performance-curves',
    ];
    const inScreen = within(screen.getByTestId('fitness-screen'));
    const ids = inScreen
      .UNSAFE_queryAllByProps({})
      .map((node) => node.props.testID as string | undefined)
      .filter((id): id is string => !!id && order.includes(id));
    expect([...new Set(ids)]).toEqual(order);
  } finally {
    request.mockRestore();
    cancel.mockRestore();
  }
});
