import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import TileCacheBudgetSheet, {
  type TileCacheBudgetSheetInput,
} from '@/app/sheets/tile-cache-budget';
import { TILE_CACHE_BUDGET_CHOICES_MB } from '@/features/maps/lib/tileCacheBudget';
import { openSheet } from '@/shared/app/sheetRequest';

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
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

function open(budgetMb: number) {
  const result = openSheet<TileCacheBudgetSheetInput, number>('sheets/tile-cache-budget', {
    budgetMb,
  });
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  render(<TileCacheBudgetSheet />);
  return result;
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('tile cache budget sheet', () => {
  it('shows every budget and marks the current one', async () => {
    const result = open(100);
    expect(screen.getByTestId('settings-tile-cache-picker')).toBeTruthy();
    for (const mb of TILE_CACHE_BUDGET_CHOICES_MB) {
      expect(screen.getByTestId(`settings-tile-cache-choice-${mb}`)).toBeTruthy();
    }
    expect(
      screen.getByTestId('settings-tile-cache-choice-100').props.accessibilityState
    ).toMatchObject({
      selected: true,
    });
    fireEvent.press(screen.getByTestId('settings-tile-cache-choice-400'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 400 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('cancels when dismissed without a selection', async () => {
    const result = open(50);
    screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
