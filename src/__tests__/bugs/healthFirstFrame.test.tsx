/**
 * Scenario: the Health tab's first visit finds its reads already cached, so
 * every card has its data on the first commit.
 *
 * Expected behaviour: the first commit paints the header, the heatmap's frame
 * and the chart placeholders with no Skia canvas in it, and the canvases and
 * the cards below them mount on the frames that follow.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type TrainingScreenWindows } from 'veloqrs';

import TrainingScreen from '@/app/(tabs)/training';
import { HEATMAP_PITCH, HEATMAP_WEEKS } from '@/features/stats/lib/heatmapGrid';
import { initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { setParams: jest.fn() },
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
    ActivityHeatmap: jest.requireActual('@/features/stats/components/ActivityHeatmap')
      .ActivityHeatmap,
    WeeklySummary: () => <View testID="weekly-summary" />,
    SeasonComparison: () => <View testID="season-comparison" />,
  };
});
jest.mock('@/features/wellness', () => {
  const { View } = require('react-native');
  return {
    WellnessTrendsChart: () => <View testID="wellness-chart-canvas" />,
    useWellnessCoverage: () => require('veloqrs').RangeCoverage.Loaded,
    useWellness: () => ({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    }),
  };
});
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

const totals = { count: 2, totalDuration: 7200, totalDistance: 20_000, totalTss: 100 };

const engine = {
  subscribe: () => () => {},
  rangeCoverage: () => RangeCoverage.Loaded,
  getTrainingScreenData: (windows: TrainingScreenWindows) => ({
    heatmap: [{ date: windows.heatmapLastDay, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    months: [],
    yearCurrent: totals,
    yearPrevious: totals,
    monthCurrent: totals,
    monthPrevious: totals,
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

it('paints the header and placeholders before any Skia canvas, then mounts the cards frame by frame', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screenOn = () => (
    <QueryClientProvider client={client}>
      <TrainingScreen />
    </QueryClientProvider>
  );

  // Warm the screen read, as an earlier mount or another card would have.
  const warm = render(screenOn());
  await waitFor(() => expect(screen.getByTestId('activity-heatmap-count')).toBeTruthy());
  warm.unmount();

  const frames: FrameRequestCallback[] = [];
  const request = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());
  // A frame runs every callback queued before it, the shimmer's animation among them.
  const runFrame = (timestamp: number) => {
    const due = frames.splice(0);
    act(() => due.forEach((callback) => callback(timestamp)));
  };

  try {
    render(screenOn());

    expect(screen.getByTestId('training-header')).toBeTruthy();
    expect(screen.getByTestId('activity-heatmap-count')).toBeTruthy();
    const placeholder = StyleSheet.flatten(
      screen.getByTestId('activity-heatmap-placeholder').props.style
    );
    expect(placeholder.width).toBe(HEATMAP_WEEKS * HEATMAP_PITCH);
    expect(placeholder.height).toBe(7 * HEATMAP_PITCH);
    expect(screen.queryAllByTestId('skia-canvas')).toHaveLength(0);
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
    expect(screen.queryByTestId('weekly-summary')).toBeNull();
    expect(screen.queryByTestId('season-comparison')).toBeNull();

    runFrame(0);
    expect(screen.queryAllByTestId('skia-canvas')).toHaveLength(1);
    expect(screen.queryByTestId('activity-heatmap-placeholder')).toBeNull();
    expect(screen.getByTestId('wellness-chart-canvas')).toBeTruthy();
    expect(screen.queryByTestId('weekly-summary')).toBeNull();

    runFrame(16);
    expect(screen.getByTestId('weekly-summary')).toBeTruthy();
    expect(screen.queryByTestId('season-comparison')).toBeNull();

    runFrame(32);
    expect(screen.getByTestId('season-comparison')).toBeTruthy();
  } finally {
    request.mockRestore();
    cancel.mockRestore();
  }
});
