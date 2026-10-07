/**
 * Scenario: the training tab opens the smoothing sheet and applies the answer to its chart.
 *
 * Expected behaviour: the button opens the sheet with the current window, a chosen preset
 * becomes the chart's window, and a dismissed sheet leaves it unchanged.
 */
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TrainingScreen from '@/app/(tabs)/training';
import { answerSheet } from '../__shared__/answerSheet';
import { useSheetRequest } from '@/shared/app/sheetRequest';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};
const mockChartWindows: unknown[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
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
jest.mock('@/features/stats', () => ({
  WeeklySummary: () => null,
  ActivityHeatmap: () => null,
  SeasonComparison: () => null,
}));
jest.mock('@/features/wellness', () => ({
  WellnessTrendsChart: ({ smoothingWindow }: { smoothingWindow: unknown }) => {
    mockChartWindows.push(smoothingWindow);
    return null;
  },
  useWellness: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/features/fitness/hooks', () => ({
  useAthleteSummary: () => ({ data: undefined, isLoading: false }),
}));

const chartWindow = () => mockChartWindows.at(-1);

function renderTraining() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TrainingScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockChartWindows.length = 0;
});

describe('training smoothing sheet', () => {
  it('opens the sheet with the current window and applies the chosen preset', async () => {
    renderTraining();
    fireEvent.press(await screen.findByTestId('training-smoothing-button'));
    expect(mockPush.mock.calls[0][0].pathname).toBe('sheets/smoothing');
    mockParams.request = mockPush.mock.calls[0][0].params.request;
    const sheet = renderHook(() => useSheetRequest<{ window: unknown }, number>());
    expect(sheet.result.current.input).toEqual({ window: 'auto' });
    act(() => sheet.result.current.resolve(14));
    sheet.unmount();
    await act(async () => {});
    expect(chartWindow()).toBe(14);
  });

  it('leaves the window unchanged when the sheet is dismissed', async () => {
    renderTraining();
    expect(chartWindow()).toBe('auto');
    fireEvent.press(await screen.findByTestId('training-smoothing-button'));
    answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(chartWindow()).toBe('auto');
  });
});
