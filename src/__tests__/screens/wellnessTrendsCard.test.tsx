/**
 * Scenario: the wellness trends card on the fitness tab follows the screen's
 * one range, owns its smoothing window, and its read can fail while the other
 * cards read their own.
 *
 * Expected behaviour: the smoothing chip sits in the card's header and the
 * card draws no range pills of its own; the chip names the window in force on
 * the range, Auto resolved, and the chip and chart wait for the stored choice
 * before they draw; the chip opens the sheet with the current window and range,
 * a chosen preset becomes the chart's window and is kept on the device, and a
 * dismissed sheet leaves it unchanged; until the chart is drawn, or while its
 * read is cold, the card holds the chart's 200 px height with a shimmer and no
 * spinner; a failed read is named inside the card with a Retry.
 */
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RangeCoverage } from 'veloqrs';

import { WellnessTrendsCard } from '@/features/fitness/components/sections/WellnessTrendsCard';
import { WELLNESS_SMOOTHING_KEY } from '@/features/fitness/lib/wellnessSmoothingPreference';
import { signalRestoreCompleted } from '@/shared/storage/restoreSignal';
import { TIME_RANGES } from '@/shared/app/constants';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { Shimmer } from '@/shared/ui';
import { answerSheet } from '../__shared__/answerSheet';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};
const mockChartWindows: unknown[] = [];

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
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

beforeEach(async () => {
  mockPush.mockClear();
  onRetry.mockClear();
  mockChartWindows.length = 0;
  await AsyncStorage.clear();
});

describe('wellness trends card controls', () => {
  vaultIt('puts the smoothing chip in the header and draws no range pills of its own', async () => {
    await renderCard();
    await screen.findByTestId('wellness-smoothing-button');
    const header = within(screen.getByTestId('wellness-trends-header'));

    expect(header.getByRole('header', { name: 'wellnessScreen.trends' })).toBeTruthy();
    expect(header.getByTestId('wellness-smoothing-button')).toBeTruthy();
    for (const range of TIME_RANGES) {
      expect(screen.queryByText(range.labelKey)).toBeNull();
    }
  });

  it('opens the smoothing sheet with the current window and range, and applies the chosen preset', async () => {
    await renderCard();
    await screen.findByTestId('wellness-smoothing-button');
    expect(chartWindow()).toBe('auto');
    void fireEvent.press(screen.getByTestId('wellness-smoothing-button'));
    expect(mockPush.mock.calls[0][0].pathname).toBe('sheets/smoothing');
    mockParams.request = mockPush.mock.calls[0][0].params.request;
    const sheet = await renderHook(() => useSheetRequest<{ window: unknown }, number>());
    expect(sheet.result.current.input).toEqual({ window: 'auto', timeRange: '3m' });
    await act(() => sheet.result.current.resolve(14));
    await sheet.unmount();
    await act(async () => {});
    expect(chartWindow()).toBe(14);
    await expect(AsyncStorage.getItem(WELLNESS_SMOOTHING_KEY)).resolves.toBe('14');
  });

  it('leaves the window unchanged when the sheet is dismissed', async () => {
    await renderCard();
    await screen.findByTestId('wellness-smoothing-button');
    void fireEvent.press(screen.getByTestId('wellness-smoothing-button'));
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(chartWindow()).toBe('auto');
    await expect(AsyncStorage.getItem(WELLNESS_SMOOTHING_KEY)).resolves.toBeNull();
  });
});

describe('wellness trends card after a restore', () => {
  it('reads the restored window without a remount', async () => {
    await renderCard({ timeRange: '1m' });
    await screen.findByTestId('wellness-smoothing-button');
    expect(chartWindow()).toBe('auto');
    await AsyncStorage.setItem(WELLNESS_SMOOTHING_KEY, '14');
    await act(async () => {
      signalRestoreCompleted();
    });
    expect(chartWindow()).toBe(14);
    expect(
      within(screen.getByTestId('wellness-smoothing-button')).getByText(
        'wellness.smoothingChip:{"count":14}'
      )
    ).toBeTruthy();
  });

  vaultIt('stops listening once unmounted', async () => {
    const view = await renderCard();
    await screen.findByTestId('wellness-smoothing-button');
    await view.unmount();
    mockChartWindows.length = 0;
    await act(async () => {
      signalRestoreCompleted();
    });
    expect(mockChartWindows).toHaveLength(0);
  });
});

describe('wellness trends card smoothing chip', () => {
  it('names the window in force for the range, Auto resolved', async () => {
    await renderCard({ timeRange: '3m' });
    expect(
      within(await screen.findByTestId('wellness-smoothing-button')).getByText(
        'wellness.smoothingChip:{"count":7}'
      )
    ).toBeTruthy();
  });

  vaultIt('names no smoothing for a range Auto leaves raw', async () => {
    await renderCard({ timeRange: '7d' });
    expect(
      within(await screen.findByTestId('wellness-smoothing-button')).getByText(
        'wellness.smoothingChipNone'
      )
    ).toBeTruthy();
  });

  it('shows the window the athlete chose on an earlier visit', async () => {
    await AsyncStorage.setItem(WELLNESS_SMOOTHING_KEY, '14');
    await renderCard({ timeRange: '1m' });
    expect(
      within(await screen.findByTestId('wellness-smoothing-button')).getByText(
        'wellness.smoothingChip:{"count":14}'
      )
    ).toBeTruthy();
    expect(chartWindow()).toBe(14);
  });

  vaultIt('is a menu button, not a selected toggle, whatever the window', async () => {
    await AsyncStorage.setItem(WELLNESS_SMOOTHING_KEY, 'none');
    await renderCard();
    expect(
      (await screen.findByTestId('wellness-smoothing-button')).props.accessibilityState?.selected
    ).toBeFalsy();
  });

  vaultIt('draws neither the chip nor the chart before the stored choice is read', async () => {
    await renderCard();
    expect(screen.queryByTestId('wellness-smoothing-button')).toBeNull();
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
    expect(await screen.findByTestId('wellness-chart-canvas')).toBeTruthy();
  });
});

describe('wellness trends card placeholder', () => {
  vaultIt.each([
    ['before its frame', { drawn: false }],
    ['on a cold read', { wellness: undefined, isLoading: true }],
  ])('holds a 200 px shimmer and no spinner %s', async (_name, props) => {
    await renderCard(props);

    expect(screen.UNSAFE_getByType(Shimmer).props.height).toBe(200);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
  });

  vaultIt('keeps the chart on screen while a held range refetches', async () => {
    await renderCard({ isLoading: true });
    expect(await screen.findByTestId('wellness-chart-canvas')).toBeTruthy();
  });
});

describe('wellness trends card with its read failing', () => {
  vaultIt('names the failure inside the card, keeps the header and draws no chart', async () => {
    await renderCard({ wellness: undefined, readError: { tag: 'Database' } });

    expect(screen.getByRole('header', { name: 'wellnessScreen.trends' })).toBeTruthy();
    expect(await screen.findByTestId('wellness-smoothing-button')).toBeTruthy();
    expect(screen.getByTestId('wellness-trends-failed')).toBeTruthy();
    expect(screen.queryByTestId('wellness-chart-canvas')).toBeNull();
  });

  it('retries the wellness read from inside the card', async () => {
    await renderCard({ wellness: undefined, readError: { tag: 'Database' } });
    await fireEvent.press(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
