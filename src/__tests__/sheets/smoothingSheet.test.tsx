/**
 * Scenario: the smoothing picker is a formSheet route that answers its caller through the sheet
 * request channel.
 *
 * Expected behaviour: a tapped preset resolves the caller with its value and dismisses, the
 * current window reads as selected, and closing without a tap cancels.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import SmoothingSheet from '@/app/sheets/smoothing';
import { openSheet } from '@/shared/app/sheetRequest';
import { SMOOTHING_PRESETS, type SmoothingWindow } from '@/shared/math/smoothing';
import { initialiseI18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

function open(current: SmoothingWindow) {
  const result = openSheet<{ window: SmoothingWindow }, SmoothingWindow>('sheets/smoothing', {
    window: current,
  });
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  render(<SmoothingSheet />);
  return result;
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
    const result = open('auto');
    for (const preset of SMOOTHING_PRESETS) {
      expect(screen.getByTestId(`smoothing-option-${preset.value}`)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId('smoothing-option-21'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 21 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('marks the current window as selected', () => {
    open('none');
    expect(screen.getByTestId('smoothing-option-none').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('smoothing-option-auto').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const result = open('auto');
    screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
