/**
 * Scenario: the fitness tab was one long scroll of a dozen cards, so the
 * calendar, the curves and the trends sat a long way under the chart and a
 * link to one of them scrolled past everything else to reach it.
 *
 * Expected behaviour: the tab is four pages on its tab row, Fitness, Calendar,
 * Performance and Trends, each holding its own cards and only the controls
 * those cards read. The range and the sport are one choice for the screen, and
 * a link opens on the page that draws what it names.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import FitnessScreen from '@/app/(tabs)/fitness';

const mockParams: { current: Record<string, string | undefined> } = { current: {} };
const mockTrendsProps: { trendsExpanded: boolean; sportMode: string }[] = [];

jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => jest.fn(),
  logMemory: jest.fn(),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  router: {
    setParams: (next: Record<string, string | undefined>) => {
      mockParams.current = { ...mockParams.current, ...next };
      for (const key of Object.keys(mockParams.current)) {
        if (mockParams.current[key] === undefined) delete mockParams.current[key];
      }
    },
  },
  useLocalSearchParams: () => mockParams.current,
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
  };
});
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: {} }),
  useCollapsibleSections: jest.requireActual('@/shared/app/useCollapsibleSections')
    .useCollapsibleSections,
}));
jest.mock('@/features/wellness', () => ({ timeRangeToDays: () => 90 }));
jest.mock('@/features/stats', () => {
  const { View } = require('react-native');
  return {
    ActivityHeatmap: () => <View testID="activity-heatmap" />,
    WeeklySummary: () => <View testID="weekly-summary" />,
    SeasonComparison: () => <View testID="season-comparison" />,
  };
});
jest.mock('@/features/fitness', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    FitnessChartCard: () => <View testID="fitness-chart-canvas" />,
    PerformanceCurveSection: () => <View testID="performance-curves" />,
    FitnessTrendSections: (props: { trendsExpanded: boolean; sportMode: string }) => {
      mockTrendsProps.push(props);
      return <View testID="fitness-trends" />;
    },
    FitnessDefinitionsCard: () => <View testID="fitness-definitions" />,
    WellnessTrendsCard: () => <View testID="wellness-card" />,
    TimeRangeSelector: ({
      timeRange,
      onTimeRangeChange,
    }: {
      timeRange: string;
      onTimeRangeChange: (range: string) => void;
    }) => (
      <View testID="fitness-time-range-selector">
        {['1m', '3m'].map((range) => (
          <Pressable
            key={range}
            testID={`fitness-range-${range}`}
            accessibilityState={{ selected: timeRange === range }}
            onPress={() => onTimeRangeChange(range)}
          />
        ))}
      </View>
    ),
    SportToggleSelector: ({ sportMode }: { sportMode: string }) => (
      <View testID="fitness-sport-toggle">
        <Text>{sportMode}</Text>
      </View>
    ),
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
    useFitnessWindow: () => {
      const [timeRange, changeTimeRange] = React.useState('3m');
      return {
        timeRange,
        changeTimeRange,
        sharedSelectedIdx: { value: -1 },
        chartInteracting: false,
        selectedDate: null,
        handleInteractionChange: jest.fn(),
        handleDateSelect: jest.fn(),
      };
    },
    useSportPreference: () => ({
      primarySport: 'Running',
      isLoaded: true,
      adoptLibrarySport: jest.fn(),
    }),
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
    // The pager's animations run on these frames too, so each frame is a
    // frame later than the last or a timed animation never ends.
    flush: async () => {
      while (frames.length > 0) await act(() => frames.shift()?.((time += 16)));
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

let frames: ReturnType<typeof runFrames>;

beforeEach(() => {
  mockParams.current = {};
  mockTrendsProps.length = 0;
  frames = runFrames();
});

afterEach(() => {
  frames.restore();
});

async function mountScreen(params: Record<string, string> = {}) {
  mockParams.current = { ...params };
  await render(<FitnessScreen />);
  await frames.flush();
}

async function visit(place: string) {
  await fireEvent.press(screen.getByTestId(`tab-${place}`));
  await frames.flush();
  return within(screen.getByTestId(`tab-page-${place}`));
}

function selectedTab(): string | undefined {
  return ['fitness', 'calendar', 'performance', 'trends'].find(
    (place) => screen.getByTestId(`tab-${place}`).props.accessibilityState?.selected
  );
}

describe('the fitness tab places', () => {
  it('shows the four places on the tab row', async () => {
    await mountScreen();

    expect(screen.getByTestId('swipeable-tabs')).toBeTruthy();
    for (const place of ['fitness', 'calendar', 'performance', 'trends']) {
      expect(screen.getByTestId(`tab-${place}`)).toBeTruthy();
    }
  });

  it('holds the chart, the wellness trends, the definitions and the range on Fitness', async () => {
    await mountScreen();

    const page = within(screen.getByTestId('tab-page-fitness'));
    expect(page.getByTestId('fitness-chart-canvas')).toBeTruthy();
    expect(page.getByTestId('wellness-trends-chart')).toBeTruthy();
    expect(page.getByTestId('fitness-definitions')).toBeTruthy();
    expect(page.getByTestId('fitness-time-range-selector')).toBeTruthy();
    expect(page.queryByTestId('fitness-sport-toggle')).toBeNull();
    expect(page.queryByTestId('weekly-summary')).toBeNull();
    expect(page.queryByTestId('performance-curves')).toBeNull();
    expect(page.queryByTestId('fitness-trends')).toBeNull();
  });

  it('holds the week, the calendar and the year comparison on Calendar, with no control', async () => {
    await mountScreen();

    const page = await visit('calendar');
    expect(page.getByTestId('weekly-summary')).toBeTruthy();
    expect(page.getByTestId('activity-heatmap')).toBeTruthy();
    expect(page.getByTestId('season-comparison')).toBeTruthy();
    expect(page.queryByTestId('fitness-time-range-selector')).toBeNull();
    expect(page.queryByTestId('fitness-sport-toggle')).toBeNull();
  });

  it('holds the range, the sport and their sections on Performance and on Trends', async () => {
    await mountScreen();

    const performance = await visit('performance');
    expect(performance.getByTestId('fitness-time-range-selector')).toBeTruthy();
    expect(performance.getByTestId('fitness-sport-toggle')).toBeTruthy();
    expect(performance.getByTestId('performance-curves')).toBeTruthy();
    expect(performance.queryByTestId('fitness-trends')).toBeNull();

    const trends = await visit('trends');
    expect(trends.getByTestId('fitness-time-range-selector')).toBeTruthy();
    expect(trends.getByTestId('fitness-sport-toggle')).toBeTruthy();
    expect(trends.getByTestId('fitness-trends')).toBeTruthy();
    expect(trends.queryByTestId('performance-curves')).toBeNull();
  });

  it('keeps a range chosen on Fitness as the range on Performance', async () => {
    await mountScreen();

    const fitness = within(screen.getByTestId('tab-page-fitness'));
    await fireEvent.press(fitness.getByTestId('fitness-range-1m'));
    const performance = await visit('performance');

    expect(performance.getByTestId('fitness-range-1m').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(performance.getByTestId('fitness-range-3m').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('opens a link to the eFTP trend on Trends, on cycling, with the trends section open', async () => {
    await mountScreen({ chart: 'ftp' });

    expect(selectedTab()).toBe('trends');
    const trends = within(screen.getByTestId('tab-page-trends'));
    expect(within(trends.getByTestId('fitness-sport-toggle')).getByText('Cycling')).toBeTruthy();
    expect(mockTrendsProps.at(-1)).toEqual(
      expect.objectContaining({ trendsExpanded: true, sportMode: 'Cycling' })
    );
  });

  it('opens a link naming the calendar page on Calendar', async () => {
    await mountScreen({ tab: 'calendar' });

    expect(selectedTab()).toBe('calendar');
    expect(
      within(screen.getByTestId('tab-page-calendar')).getByTestId('activity-heatmap')
    ).toBeTruthy();
  });

  it('opens on Fitness with no link', async () => {
    await mountScreen();

    expect(selectedTab()).toBe('fitness');
  });

  it('opens a link naming a wellness chart and the calendar page on Fitness, where the chart is', async () => {
    await mountScreen({ chart: 'hrv', tab: 'calendar' });

    expect(selectedTab()).toBe('fitness');
  });

  it('moves to the page a link names while the screen is mounted', async () => {
    const view = await render(<FitnessScreen />);
    await frames.flush();
    expect(selectedTab()).toBe('fitness');

    mockParams.current = { tab: 'performance' };
    await view.rerender(<FitnessScreen />);
    await frames.flush();

    expect(selectedTab()).toBe('performance');
    expect(mockParams.current.tab).toBeUndefined();
  });
});
