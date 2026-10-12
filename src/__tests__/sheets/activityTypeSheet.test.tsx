/**
 * Scenario: the activity type picker is a formSheet route that answers its caller
 * through the sheet request channel.
 *
 * Expected behaviour: a tap resolves the caller with the chosen type and dismisses
 * the sheet, closing it without a tap cancels, and each mode lists its own types.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ActivityTypeSheet from '@/app/sheets/activity-type';
import { openSheet } from '@/shared/app/sheetRequest';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import { initialiseI18n } from '@/i18n';
import type { ActivityType } from '@/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};
const mockScreenOptions: Record<string, unknown>[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

type Input = { selectedType: ActivityType; mode: 'review' | 'recording' };

async function open(input: Input) {
  const result = openSheet<Input, ActivityType>('sheets/activity-type', input);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<ActivityTypeSheet />);
  return { result };
}

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockScreenOptions.length = 0;
});

describe('activity type sheet', () => {
  it('resolves the caller with the tapped type and dismisses', async () => {
    const { result } = await open({ selectedType: 'Ride', mode: 'review' });
    await fireEvent.press(screen.getByTestId('activity-type-option-Run'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'Run' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const { result } = await open({ selectedType: 'Ride', mode: 'recording' });
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('lists the curated set in review and every category in recording', async () => {
    await open({ selectedType: 'Ride', mode: 'review' });
    expect(screen.queryByTestId('activity-type-option-Kayaking')).toBeNull();
    await screen.unmount();
    await open({ selectedType: 'Ride', mode: 'recording' });
    expect(screen.UNSAFE_getByType(FlatList).props.data).toContain('Kayaking');
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await open({ selectedType: 'Ride', mode: 'review' });
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('turns the dismiss gesture off in review only', async () => {
    await open({ selectedType: 'Ride', mode: 'review' });
    expect(mockScreenOptions.at(-1)).toMatchObject({ gestureEnabled: false });
    await screen.unmount();
    mockScreenOptions.length = 0;
    await open({ selectedType: 'Ride', mode: 'recording' });
    expect(mockScreenOptions.at(-1)).toMatchObject({ gestureEnabled: true });
  });
});
