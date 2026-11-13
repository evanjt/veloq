/**
 * Scenario: the day's activity picker is a formSheet route that answers its caller through the
 * sheet request channel.
 *
 * Expected behaviour: it lists the activities it was given, a tapped row resolves the caller
 * with that activity's id, and closing without a tap cancels.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import DayActivitiesSheet, { type DayActivitiesInput } from '@/app/sheets/day-activities';
import { rootScreenLayout } from '@/shared/ui/rootScreenLayout';
import { openSheet } from '@/shared/app/sheetRequest';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import { initialiseI18n } from '@/i18n';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';

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

const INPUT: DayActivitiesInput = {
  activities: [
    {
      id: 'a1',
      name: 'Morning ride',
      type: 'Ride',
      load: 80,
      startDateLocal: '2026-03-10T07:05:00',
      movingTime: 3600,
      distance: 30000,
    },
    {
      id: 'a2',
      name: 'Lunch run',
      type: 'Run',
      load: 0,
      startDateLocal: '2026-03-10T12:30:00',
      movingTime: 1800,
      distance: 6000,
    },
    {
      id: 'a3',
      name: 'Evening ride',
      type: 'Ride',
      load: 40,
      startDateLocal: '2026-03-10T18:45:00',
      movingTime: 2700,
      distance: 20000,
    },
  ],
};

const SAME_NAMES: DayActivitiesInput = {
  activities: [
    {
      id: 'g1',
      name: 'Gravel loop',
      type: 'GravelRide',
      load: 60,
      startDateLocal: '2026-03-10T06:15:00',
      movingTime: 5400,
      distance: 42000,
    },
    {
      id: 'g2',
      name: 'Gravel loop',
      type: 'GravelRide',
      load: 60,
      startDateLocal: '2026-03-10T17:40:00',
      movingTime: 5400,
      distance: 42000,
    },
    {
      id: 'e1',
      name: 'Commute',
      type: 'EBikeRide',
      load: 0,
      startDateLocal: '2026-03-10T08:00:00',
      movingTime: 900,
      distance: 0,
    },
  ],
};

const EMOJI = /\p{Extended_Pictographic}/u;

async function open(input: DayActivitiesInput = INPUT) {
  const result = openSheet<DayActivitiesInput, string>('sheets/day-activities', input);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(
    rootScreenLayout({ route: { name: 'sheets/day-activities' }, children: <DayActivitiesSheet /> })
  );
  return { result };
}

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  useUnitPreference.setState({ unitPreference: 'metric' });
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('day activities sheet', () => {
  it('resolves the caller with the id of the tapped activity', async () => {
    const { result } = await open();
    expect(screen.getByText('Lunch run')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('day-activity-a2'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'a2' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows a load only for an activity that has one', async () => {
    await open();
    expect(screen.getByTestId('day-activity-a1')).toHaveTextContent(/Training load 80/);
    expect(screen.getByTestId('day-activity-a2')).not.toHaveTextContent(/Training load/);
  });

  it('marks each sport with its icon and never with an emoji', async () => {
    await open(SAME_NAMES);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(EMOJI);
    const icons = screen
      .UNSAFE_getAllByType(MaterialCommunityIcons)
      .map((icon) => icon.props.name)
      .filter((name) => name !== 'chevron-right');
    expect(icons).toEqual(['bike', 'bike', 'bike-fast']);
  });

  it('tells two same-named activities apart by start time', async () => {
    await open(SAME_NAMES);
    const first = screen.getByTestId('day-activity-g1');
    const second = screen.getByTestId('day-activity-g2');
    expect(first).toHaveTextContent(/6:15/);
    expect(second).toHaveTextContent(/5:40|17:40/);
    expect(first).not.toHaveTextContent(/5:40|17:40/);
  });

  it('shows moving time, and distance only where there is one', async () => {
    await open(SAME_NAMES);
    expect(screen.getByTestId('day-activity-g1')).toHaveTextContent(/1:30:00/);
    expect(screen.getByTestId('day-activity-g1')).toHaveTextContent(/42\.0 km/);
    expect(screen.getByTestId('day-activity-e1')).toHaveTextContent(/15:00/);
    expect(screen.getByTestId('day-activity-e1')).not.toHaveTextContent(/km/);
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await open();
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const { result } = await open();
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
