/**
 * Scenario: the fitness tab is four pages, and its first page holds the
 * fitness chart, the wellness trends and the definitions, while the calendar
 * page holds the week, the activity calendar and the year comparison.
 *
 * Expected behaviour: the first visit paints the range selector and a chart
 * placeholder before mounting the chart canvas, the cards below it follow on
 * the next frame and the wellness canvas on the one after. The calendar page
 * mounts nothing until it is visited, then paints its cards one per frame.
 * The pages that read the range pin it, with the sport row where the page has
 * one, as the scroll's sticky header; the calendar page pins nothing.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

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
    onHeaderLayout: jest.fn(),
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
    FitnessDefinitionsCard: () => <View testID="fitness-definitions" />,
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
      training: { retry: jest.fn() },
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

function runFrames() {
  const frames: FrameRequestCallback[] = [];
  const request = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());
  let time = 0;
  return {
    /** Runs one frame: every callback asked for before it, at one timestamp. */
    next: async () => {
      const pending = frames.splice(0);
      time += 16;
      await act(() => pending.forEach((frame) => frame(time)));
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

it('paints the range selector and a chart placeholder before mounting the chart and the cards under it', async () => {
  const frames = runFrames();
  try {
    await render(<FitnessScreen />);
    const page = within(screen.getByTestId('tab-page-fitness'));
    expect(page.getByTestId('time-range')).toBeTruthy();
    expect(
      StyleSheet.flatten(page.getByTestId('fitness-chart-placeholder').props.style).height
    ).toBe(500);
    expect(page.queryByTestId('fitness-chart-canvas')).toBeNull();
    expect(page.queryByTestId('wellness-trends-chart')).toBeNull();

    await frames.next();
    expect(page.queryByTestId('fitness-chart-canvas')).toBeNull();

    await frames.next();
    expect(page.getByTestId('fitness-chart-canvas')).toBeTruthy();
    expect(page.queryByTestId('fitness-chart-placeholder')).toBeNull();
    expect(page.queryByTestId('wellness-trends-chart')).toBeNull();

    await frames.next();
    expect(page.getByTestId('wellness-chart-shimmer')).toBeTruthy();
    expect(page.getByTestId('fitness-definitions')).toBeTruthy();

    await frames.next();
    expect(page.getByTestId('wellness-chart-canvas')).toBeTruthy();

    const order = [
      'time-range',
      'fitness-chart-canvas',
      'wellness-trends-chart',
      'fitness-definitions',
    ];
    const ids = page
      .UNSAFE_queryAllByProps({})
      .map((node) => node.props.testID as string | undefined)
      .filter((id): id is string => !!id && order.includes(id));
    expect([...new Set(ids)]).toEqual(order);
  } finally {
    frames.restore();
  }
});

it('mounts the calendar page on its first visit and paints its cards one per frame', async () => {
  const frames = runFrames();
  try {
    await render(<FitnessScreen />);
    for (let i = 0; i < 4; i++) await frames.next();
    expect(screen.queryByTestId('activity-heatmap-placeholder')).toBeNull();
    expect(screen.queryByTestId('weekly-summary')).toBeNull();

    await fireEvent.press(screen.getByTestId('tab-calendar'));
    const page = within(screen.getByTestId('tab-page-calendar'));
    expect(page.getByTestId('activity-heatmap-placeholder')).toBeTruthy();
    expect(page.queryByTestId('weekly-summary')).toBeNull();
    expect(page.queryByTestId('season-comparison')).toBeNull();

    await frames.next();
    expect(page.getByTestId('weekly-summary')).toBeTruthy();
    expect(page.getByTestId('activity-heatmap-placeholder')).toBeTruthy();

    await frames.next();
    expect(page.getByTestId('activity-heatmap-canvas')).toBeTruthy();
    expect(page.queryByTestId('season-comparison')).toBeNull();

    await frames.next();
    expect(page.getByTestId('season-comparison')).toBeTruthy();

    const order = ['weekly-summary', 'activity-heatmap-canvas', 'season-comparison'];
    const ids = page
      .UNSAFE_queryAllByProps({})
      .map((node) => node.props.testID as string | undefined)
      .filter((id): id is string => !!id && order.includes(id));
    expect([...new Set(ids)]).toEqual(order);
  } finally {
    frames.restore();
  }
});

/** The page's scroll, and the ids inside its first child when that child is pinned. */
function pinnedOn(place: string) {
  const scroll = within(screen.getByTestId(`tab-page-${place}`)).UNSAFE_getByType(ScrollView);
  const sticky = scroll.props.stickyHeaderIndices as number[] | undefined;
  const header = within(scroll).queryByTestId('fitness-pinned-header');
  const first = React.Children.toArray(scroll.props.children)[0] as React.ReactElement<{
    testID?: string;
  }>;
  const ids = header
    ? header
        .findAll((node) => typeof node.props.testID === 'string', { deep: true })
        .map((node) => node.props.testID as string)
    : [];
  return { sticky, firstIsHeader: first?.props.testID === 'fitness-pinned-header', ids };
}

it('pins the range on the fitness page, the range and the sport row on performance and trends, and nothing on the calendar', async () => {
  await render(<FitnessScreen />);

  const fitness = pinnedOn('fitness');
  expect(fitness.sticky).toEqual([0]);
  expect(fitness.firstIsHeader).toBe(true);
  expect(fitness.ids).toContain('time-range');
  expect(fitness.ids).not.toContain('sport-toggle');

  for (const place of ['performance', 'trends']) {
    await fireEvent.press(screen.getByTestId(`tab-${place}`));
    const pinned = pinnedOn(place);
    expect(pinned.sticky).toEqual([0]);
    expect(pinned.firstIsHeader).toBe(true);
    expect([...new Set(pinned.ids)].filter((id) => id !== 'fitness-pinned-header')).toEqual([
      'time-range',
      'sport-toggle',
    ]);
  }

  await fireEvent.press(screen.getByTestId('tab-calendar'));
  const calendar = pinnedOn('calendar');
  expect(calendar.sticky).toBeUndefined();
  expect(calendar.firstIsHeader).toBe(false);
  expect(calendar.ids).toEqual([]);
});
