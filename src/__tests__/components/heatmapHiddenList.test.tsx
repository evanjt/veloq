/**
 * Scenario: the athlete hid two activities from the heatmap and opens the maps
 * settings to bring one back.
 *
 * Expected behaviour: each hidden activity is listed by name, pressing one
 * shows it on the heatmap again and drops it from the list, and with nothing
 * hidden the section draws nothing.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HeatmapHiddenList } from '@/features/settings/components/HeatmapHiddenList';

const mockHidden = jest.fn();
const mockSet = jest.fn();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    heatmap: {
      heatmapHiddenActivities: (...args: unknown[]) => mockHidden(...args),
      setActivityHeatmapHidden: (...args: unknown[]) => mockSet(...args),
    },
  })
);

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const flight = {
  activityId: 'flight-1',
  name: 'Night flight',
  sportType: 'Ride',
  date: 1_700_900_000,
};
const loop = { activityId: 'loop-1', name: 'Lake loop', sportType: 'Ride', date: 1_700_000_000 };

beforeEach(() => {
  mockHidden.mockReset();
  mockSet.mockReset();
});

it('lists each hidden activity and shows the one pressed again', async () => {
  mockHidden.mockReturnValueOnce([flight, loop]).mockReturnValueOnce([loop]);
  mockSet.mockReturnValue(true);
  await render(<HeatmapHiddenList />);

  expect(screen.getByText('Night flight')).toBeTruthy();
  expect(screen.getByText('Lake loop')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('heatmap-hidden-flight-1'));

  expect(mockSet).toHaveBeenCalledWith('flight-1', false);
  expect(screen.queryByText('Night flight')).toBeNull();
  expect(screen.getByText('Lake loop')).toBeTruthy();
});

it('keeps an activity listed when the engine did not store the choice', async () => {
  mockHidden.mockReturnValue([flight]);
  mockSet.mockReturnValue(false);
  await render(<HeatmapHiddenList />);

  await fireEvent.press(screen.getByTestId('heatmap-hidden-flight-1'));

  expect(screen.getByText('Night flight')).toBeTruthy();
});

vaultIt('draws nothing when no activity is hidden', async () => {
  mockHidden.mockReturnValue([]);
  await render(<HeatmapHiddenList />);

  expect(screen.queryByTestId('heatmap-hidden-list')).toBeNull();
});
