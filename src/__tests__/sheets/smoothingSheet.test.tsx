/**
 * Scenario: the smoothing picker is a formSheet route that answers its caller through the sheet
 * request channel.
 *
 * Expected behaviour: a tapped preset resolves the caller with its value and dismisses, the
 * current window reads as selected, and closing without a tap cancels.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import SmoothingSheet, { type SmoothingSheetInput } from '@/app/sheets/smoothing';
import type { TimeRange } from '@/shared/app/timeRange';
import { openSheet } from '@/shared/app/sheetRequest';
import { SMOOTHING_PRESETS, type SmoothingWindow } from '@/shared/math/smoothing';
import { initialiseI18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

async function open(current: SmoothingWindow, timeRange: TimeRange = '3m') {
  const result = openSheet<SmoothingSheetInput, SmoothingWindow>('sheets/smoothing', {
    window: current,
    timeRange,
  });
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<SmoothingSheet />);
  return { result };
}

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('smoothing sheet', () => {
  it('lists every preset and resolves the caller with the tapped one', async () => {
    const { result } = await open('auto');
    for (const preset of SMOOTHING_PRESETS) {
      expect(screen.getByTestId(`smoothing-option-${preset.value}`)).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('smoothing-option-21'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 21 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('marks the current window as selected', async () => {
    await open('none');
    expect(screen.getByTestId('smoothing-option-none').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('smoothing-option-auto').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('names the window Auto resolves to for the range the caller shows', async () => {
    await open('auto', '6m');
    expect(
      within(screen.getByTestId('smoothing-option-auto')).getByText('Auto, 14 days')
    ).toBeTruthy();
  });

  it('names Auto as no smoothing where the range has none', async () => {
    await open('auto', '7d');
    expect(
      within(screen.getByTestId('smoothing-option-auto')).getByText('Auto, no smoothing')
    ).toBeTruthy();
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const { result } = await open('auto');
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
