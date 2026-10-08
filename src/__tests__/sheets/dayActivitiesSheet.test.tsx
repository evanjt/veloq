/**
 * Scenario: the day's activity picker is a formSheet route that answers its caller through the
 * sheet request channel.
 *
 * Expected behaviour: it lists the activities it was given, a tapped row resolves the caller
 * with that activity's id, and closing without a tap cancels.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import DayActivitiesSheet, { type DayActivitiesInput } from '@/app/sheets/day-activities';
import { openSheet } from '@/shared/app/sheetRequest';
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

const INPUT: DayActivitiesInput = {
  activities: [
    { id: 'a1', name: 'Morning ride', type: 'Ride', load: 80 },
    { id: 'a2', name: 'Lunch run', type: 'Run', load: 0 },
    { id: 'a3', name: 'Evening ride', type: 'Ride', load: 40 },
  ],
};

function open() {
  const result = openSheet<DayActivitiesInput, string>('sheets/day-activities', INPUT);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  render(<DayActivitiesSheet />);
  return result;
}

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('day activities sheet', () => {
  it('resolves the caller with the id of the tapped activity', async () => {
    const result = open();
    expect(screen.getByText('Lunch run')).toBeTruthy();
    fireEvent.press(screen.getByTestId('day-activity-a2'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'a2' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows a load only for an activity that has one', () => {
    open();
    expect(screen.getByTestId('day-activity-a1')).toHaveTextContent(/80/);
    expect(screen.getByTestId('day-activity-a2')).not.toHaveTextContent(/\b0\b/);
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const result = open();
    screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
