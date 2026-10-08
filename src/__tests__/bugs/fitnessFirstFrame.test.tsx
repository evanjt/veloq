/**
 * The first visit paints the range selector and a chart placeholder before
 * mounting chart canvases and lower sections.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import FitnessScreen from '@/app/(tabs)/fitness';

jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => jest.fn(),
  logMemory: jest.fn(),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
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
    ScreenSafeAreaView: View,
    TAB_BAR_SAFE_PADDING: 0,
    ChartSkeleton: View,
    ErrorStatePreset: View,
    ExplanationCard: View,
  };
});
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/shared/native/useSyncRefreshNotice', () => ({
  SyncRefreshNotice: () => null,
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
jest.mock('@/features/fitness', () => {
  const { View } = require('react-native');
  return {
    FitnessChartCard: () => <View testID="fitness-chart-canvas" />,
    PerformanceCurveSection: () => <View testID="performance-curves" />,
    FitnessTrendSections: () => <View testID="fitness-trends" />,
    TimeRangeSelector: () => <View testID="time-range" />,
    SportToggleSelector: () => <View testID="sport-toggle" />,
    BestEffortsHeaderButton: () => null,
    resolveThresholdPace: () => null,
    useFitnessRefresh: () => ({ isRefreshing: false, onRefresh: jest.fn(), notice: null }),
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
    useSportPreference: () => ({ primarySport: 'Cycling' }),
    FORM_ZONE_COLORS: { optimal: 'green' },
  };
});

it('paints the range selector and a chart placeholder before mounting the chart and performance section', () => {
  const frames: FrameRequestCallback[] = [];
  const request = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());

  try {
    render(<FitnessScreen />);
    expect(screen.getByTestId('time-range')).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByTestId('fitness-chart-placeholder').props.style).height
    ).toBe(500);
    expect(screen.queryByTestId('fitness-chart-canvas')).toBeNull();
    expect(screen.queryByTestId('performance-curves')).toBeNull();
    expect(screen.queryByTestId('fitness-trends')).toBeNull();

    act(() => frames.shift()?.(0));
    expect(screen.queryByTestId('fitness-chart-canvas')).toBeNull();

    act(() => frames.shift()?.(16));
    expect(screen.getByTestId('fitness-chart-canvas')).toBeTruthy();
    expect(screen.queryByTestId('fitness-chart-placeholder')).toBeNull();
    expect(screen.queryByTestId('performance-curves')).toBeNull();

    act(() => frames.shift()?.(32));
    expect(screen.getByTestId('performance-curves')).toBeTruthy();
    expect(screen.getByTestId('fitness-trends')).toBeTruthy();
  } finally {
    request.mockRestore();
    cancel.mockRestore();
  }
});
