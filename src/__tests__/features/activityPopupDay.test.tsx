/**
 * Scenario: the athlete taps a ride on the map and its popup names the day.
 *
 * Expected behaviour: the popup prints the day the ride was ridden, in any zone.
 * The engine stores the wall clock as UTC, so the day is read from the UTC
 * fields and never shifted by the device offset.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  ActivityPopup,
  type SelectedActivity,
} from '@/features/maps/components/regional/ActivityPopup';
import { formatFullDateWithWeekday } from '@/shared/format/format';
import { initialiseI18n } from '@/i18n';

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

function selectedAt(date: number): SelectedActivity {
  return {
    activity: {
      id: 'day-ride',
      bounds: [
        [46.1, 7.1],
        [46.2, 7.2],
      ],
      type: 'Ride',
      name: 'Day ride',
      date,
      distance: 12000,
      duration: 1800,
    },
    mapData: null,
    isLoading: false,
  };
}

async function showPopupAt(date: number) {
  await render(
    <ActivityPopup
      selected={selectedAt(date)}
      bottom={0}
      onZoom={jest.fn()}
      onClose={jest.fn()}
      onViewDetails={jest.fn()}
    />
  );
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('activity popup day', () => {
  it('names the afternoon ride on the day it was ridden', async () => {
    await showPopupAt(Date.UTC(2026, 10, 5, 15) / 1000);
    expect(screen.getByText(formatFullDateWithWeekday(new Date(2026, 10, 5)))).toBeTruthy();
  });

  vaultIt('names the early ride on the day it was ridden', async () => {
    await showPopupAt(Date.UTC(2026, 10, 5, 7) / 1000);
    expect(screen.getByText(formatFullDateWithWeekday(new Date(2026, 10, 5)))).toBeTruthy();
  });
});
