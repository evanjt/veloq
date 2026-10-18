/**
 * Scenario: the wellness trends card on the fitness tab follows the screen's
 * one range, owns its smoothing window, and its read can fail while the other
 * cards read their own.
 *
 * Expected behaviour: the smoothing button sits in the card's header and the
 * card draws no range pills of its own; the button opens the sheet with the
 * current window, a chosen preset becomes the chart's window and a dismissed
 * sheet leaves it unchanged; until the chart is drawn, or while its read is
 * cold, the card holds the chart's 200 px height with a shimmer and no
 * spinner; a failed read is named inside the card with a Retry.
 */
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import { WellnessTrendsCard } from '@/features/fitness/components/sections/WellnessTrendsCard';
import { TIME_RANGES } from '@/shared/app/constants';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { Shimmer } from '@/shared/ui';
import { answerSheet } from '../__shared__/answerSheet';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};
const mockChartWindows: unknown[] = [];

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('@/features/wellness', () => {
  const { View } = require('react-native');
  return {
    WellnessTrendsChart: ({ smoothingWindow }: { smoothingWindow: unknown }) => {
      mockChartWindows.push(smoothingWindow);
      return <View testID="wellness-chart-canvas" />;
    },
  };
});

const onRetry = jest.fn();

function renderCard(props: Partial<React.ComponentProps<typeof WellnessTrendsCard>> = {}) {
  return render(
    <WellnessTrendsCard
      wellness={[]}
      coverage={RangeCoverage.Loaded}
      timeRange="3m"
      drawn
      isLoading={false}
      held={false}
      readError={undefined}
      onRetry={onRetry}
      onDateSelect={jest.fn()}
      {...props}
    />
  );
}

const chartWindow = () => mockChartWindows.at(-1);

beforeEach(() => {
  mockPush.mockClear();
  onRetry.mockClear();
  mockChartWindows.length = 0;
});

describe('wellness trends card controls', () => {
  it('puts the smoothing button in the header and draws no range pills of its own', async () => {
    await renderCard();
    const header = within(screen.getByTestId('wellness-trends-header'));

    expect(header.getByRole('header', { name: 'wellnessScreen.trends' })).toBeTruthy();
    expect(header.getByTestId('wellness-smoothing-button')).toBeTruthy();
    for (const range of TIME_RANGES) {
      expect(screen.queryByText(range.labelKey)).toBeNull();
    }
  });

  it('opens the smoothing sheet with the current window and applies the chosen preset', async () => {
    await renderCard();
    expect(chartWindow()).toBe('auto');
    void fireEvent.press(screen.getByTestId('wellness-smoothing-button'));
    expect(mockPush.mock.calls[0][0].pathname).toBe('sheets/smoothing');
    mockParams.request = mockPush.mock.calls[0][0].params.request;
    const sheet = await renderHook(() => useSheetRequest<{ window: unknown }, number>());
    expect(sheet.result.current.input).toEqual({ window: 'auto' });
    await act(() => sheet.result.current.resolve(14));
    await sheet.unmount();
    await act(async () => {});
    expect(chartWindow()).toBe(14);
  });

  it('leaves the window unchanged when the sheet is dismissed', async () => {
    await renderCard();
    void fireEvent.press(screen.getByTestId('wellness-smoothing-button'));
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(chartWindow()).toBe('auto');
  });
});

describe('wellness trends card placeholder', () => {
  it.each([
    ['before its frame', { drawn: false }],
    ['on a cold read', { wellness: undefined, isLoading: true }],
  ])('holds a 200 px shimmer and no spinner %s', async (_name, props) => {
    await renderCard(props);

    expect(screen.UNSAFE_getByType(Shimmer).props.height).toBe(200);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
  });

  it('keeps the chart on screen while a held range refetches', async () => {
    await renderCard({ isLoading: true });
    expect(screen.getByTestId('wellness-chart-canvas')).toBeTruthy();
  });
});

describe('wellness trends card with its read failing', () => {
  it('names the failure inside the card, keeps the header and draws no chart', async () => {
    await renderCard({ wellness: undefined, readError: { tag: 'Database' } });

    expect(screen.getByRole('header', { name: 'wellnessScreen.trends' })).toBeTruthy();
    expect(screen.getByTestId('wellness-smoothing-button')).toBeTruthy();
    expect(screen.getByTestId('wellness-trends-failed')).toBeTruthy();
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
  });

  it('retries the wellness read from inside the card', async () => {
    await renderCard({ wellness: undefined, readError: { tag: 'Database' } });
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
