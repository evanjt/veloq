/**
 * Scenario: the wellness read throws while curves, bests, zones and decoupling read their own.
 *
 * Expected behaviour: the screen keeps its header items, range selector, pull to refresh and
 * every section, and only the fitness chart card shows the read failure with a Retry.
 */
import React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import FitnessScreen from '@/app/(tabs)/fitness';
import { FitnessChartCard } from '@/features/fitness/components/sections/FitnessChartCard';

const mockError = { tag: 'Database' };
const mockRefetch = jest.fn();
const mockCardProps: unknown[] = [];

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
  };
});
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: {} }),
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
    FitnessChartCard: (props: unknown) => {
      mockCardProps.push(props);
      return <View testID="fitness-chart-canvas" />;
    },
    PerformanceCurveSection: () => <View testID="performance-curves" />,
    FitnessTrendSections: () => <View testID="fitness-trends" />,
    FitnessDefinitionsCard: View,
    TimeRangeSelector: () => <View testID="time-range" />,
    SportToggleSelector: () => <View testID="sport-toggle" />,
    BestEffortsHeaderButton: () => null,
    resolveThresholdPace: () => null,
    useFitnessRefresh: () => ({ isRefreshing: false, onRefresh: jest.fn() }),
    useFitnessComputations: () => ({ ftpTrend: [], dominantZone: null }),
    useFitnessScreenData: () => ({
      wellness: undefined,
      activities: [],
      dailyLoads: [],
      eftpChanges: [],
      isLoading: false,
      isFetching: false,
      isError: true,
      error: mockError,
      refetch: mockRefetch,
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

jest.mock('@/features/fitness/components', () => ({
  FitnessChart: () => null,
  FormZoneChart: () => null,
  ActivityDotsChart: () => null,
}));
jest.mock('@/features/fitness/components/sections/FitnessChartCard', () =>
  jest.requireActual('@/features/fitness/components/sections/FitnessChartCard')
);

function runFrames() {
  const frames: FrameRequestCallback[] = [];
  const request = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());
  return {
    flush: async () => {
      while (frames.length > 0) await act(() => frames.shift()?.(0));
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

beforeEach(() => {
  mockRefetch.mockClear();
  mockCardProps.length = 0;
});

describe('fitness tab with the wellness read failing', () => {
  it('keeps the header, range selector, refresh and independent sections mounted', async () => {
    const frames = runFrames();
    try {
      await render(<FitnessScreen />);
      await frames.flush();
      expect(screen.getByTestId('native-header-right')).toBeTruthy();
      expect(screen.getByTestId('time-range')).toBeTruthy();
      expect(screen.UNSAFE_getAllByType(RefreshControl)).toHaveLength(1);
      expect(screen.getByTestId('fitness-chart-canvas')).toBeTruthy();
      expect(screen.getByTestId('performance-curves')).toBeTruthy();
      expect(screen.getByTestId('fitness-trends')).toBeTruthy();
      expect(mockCardProps.at(-1)).toEqual(
        expect.objectContaining({ readError: mockError, onRetry: expect.any(Function) })
      );
    } finally {
      frames.restore();
    }
  });
});

describe('fitness chart card with the wellness read failing', () => {
  function renderFailedCard(onRetry: () => void, readError: unknown = mockError) {
    return render(
      <FitnessChartCard
        wellness={[]}
        wellnessCoverage={RangeCoverage.NotFetched}
        activities={[]}
        dailyLoads={[]}
        eftpChanges={[]}
        selectedDate={null}
        sharedSelectedIdx={{ value: -1 } as never}
        onDateSelect={jest.fn()}
        onInteractionChange={jest.fn()}
        readError={readError}
        onRetry={onRetry}
      />
    );
  }

  it('shows the read failure in place of the charts and retries from it', async () => {
    const onRetry = jest.fn();
    await renderFailedCard(onRetry);
    expect(screen.getByTestId('fitness-chart-failed')).toBeTruthy();
    expect(screen.queryByTestId('fitness-form-zone-chart')).toBeNull();
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('names a busy engine rather than a generic failure', async () => {
    await renderFailedCard(jest.fn(), { tag: 'Busy', message: 'a job is running' });
    expect(screen.getByText('engine.failure.busy')).toBeTruthy();
    expect(screen.queryByText('emptyState.error.description')).toBeNull();
  });

  it("names a failure that is not the engine's with the generic line", async () => {
    await renderFailedCard(jest.fn(), new TypeError('Network request failed'));
    expect(screen.getByText('emptyState.error.description')).toBeTruthy();
  });
});
