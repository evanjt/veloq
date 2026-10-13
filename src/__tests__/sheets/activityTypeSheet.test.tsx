/**
 * Scenario: the activity type picker is a formSheet route that answers its caller
 * through the sheet request channel.
 *
 * Expected behaviour: a tap resolves the caller with the chosen type and dismisses
 * the sheet, closing it without a tap cancels, and both callers get the same
 * sectioned list, recent sports first, with the current sport always present and
 * the sheet always dismissible by swipe.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ActivityTypeSheet from '@/app/sheets/activity-type';
import { openSheet } from '@/shared/app/sheetRequest';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import { initialiseI18n } from '@/i18n';
import { useRecordingPreferences } from '@/features/recording';
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
  useRecordingPreferences.setState({ recentActivityTypes: [] });
});

function selected(testID: string): boolean | undefined {
  return screen.getByTestId(testID).props.accessibilityState?.selected;
}

function rowIds(): string[] {
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      /^activity-type-(option|recent)-/.test(node.props.testID)
  ).map((node) => node.props.testID as string);
}

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

  it('shows the recorded sport selected at review', async () => {
    await open({ selectedType: 'Kayaking', mode: 'review' });
    expect(selected('activity-type-option-Kayaking')).toBe(true);
  });

  it('lists the same rows for both callers', async () => {
    await open({ selectedType: 'Tennis', mode: 'review' });
    const review = rowIds();
    const reviewStyle = screen.getByTestId('activity-type-option-Tennis').props.style;
    await screen.unmount();
    await open({ selectedType: 'Tennis', mode: 'recording' });
    expect(rowIds()).toEqual(review);
    expect(screen.getByTestId('activity-type-option-Tennis').props.style).toEqual(reviewStyle);
    expect(review).toContain('activity-type-option-Snowboard');
  });

  it('lists a current sport that no category holds', async () => {
    await open({ selectedType: 'Cyclocross', mode: 'review' });
    expect(selected('activity-type-option-Cyclocross')).toBe(true);
  });

  it('puts recent sports first, under their own heading', async () => {
    useRecordingPreferences.setState({ recentActivityTypes: ['Tennis', 'Run'] });
    await open({ selectedType: 'Run', mode: 'review' });
    const ids = rowIds();
    expect(ids.slice(0, 2)).toEqual(['activity-type-recent-Tennis', 'activity-type-recent-Run']);
    expect(selected('activity-type-recent-Run')).toBe(true);
    expect(ids).toContain('activity-type-option-Tennis');
    expect(screen.getByTestId('activity-type-section-recent')).toBeTruthy();
    expect(screen.getByTestId('activity-type-section-racket')).toBeTruthy();
  });

  it('draws no recent heading before anything is recorded', async () => {
    await open({ selectedType: 'Ride', mode: 'recording' });
    expect(screen.queryByTestId('activity-type-section-recent')).toBeNull();
    expect(rowIds()[0]).toBe('activity-type-option-Ride');
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await open({ selectedType: 'Ride', mode: 'review' });
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('never turns the dismiss gesture off', async () => {
    for (const mode of ['review', 'recording'] as const) {
      await open({ selectedType: 'Ride', mode });
      await screen.unmount();
    }
    expect(mockScreenOptions).not.toContainEqual(
      expect.objectContaining({ gestureEnabled: false })
    );
  });
});
