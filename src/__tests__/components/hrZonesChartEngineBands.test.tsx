/**
 * Scenario: the saved activity chart built its bands and bucketed the stream in
 * TypeScript, from sport settings it read itself.
 * Expected behaviour: it draws exactly the bands and times the activity detail
 * read resolved, and reads no sport settings of its own.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { HRZonesChart } from '@/features/activity/components/HRZonesChart';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockUseSportSettings = jest.fn(() => ({ data: undefined }));
jest.mock('@/shared/app/useSportSettings', () => ({
  ...jest.requireActual('@/shared/app/useSportSettings'),
  useSportSettings: () => mockUseSportSettings(),
}));

const bands = [
  { zone: 1, minBpm: 0, maxBpm: 140, seconds: 90, percent: 75 },
  { zone: 2, minBpm: 140, maxBpm: 155, seconds: 30, percent: 25 },
  { zone: 3, minBpm: 155, maxBpm: 170, seconds: 0, percent: 0 },
  { zone: 4, minBpm: 170, maxBpm: 185, seconds: 0, percent: 0 },
  { zone: 5, minBpm: 185, maxBpm: 200, seconds: 0, percent: 0 },
];

it('renders the engine bands and times as given, with no sport settings read', () => {
  const { getByText, queryByText } = render(<HRZonesChart hrZones={bands} maxHR={200} />);

  expect(getByText('Z1')).toBeTruthy();
  expect(getByText('75%')).toBeTruthy();
  expect(getByText('25%')).toBeTruthy();
  expect(getByText('0-140')).toBeTruthy();
  expect(getByText('140-155')).toBeTruthy();
  expect(getByText('185-200')).toBeTruthy();
  expect(queryByText('Z6')).toBeNull();
  expect(mockUseSportSettings).not.toHaveBeenCalled();
});

it('shows the placeholder when the engine has no zone time', () => {
  const { getByText } = render(<HRZonesChart hrZones={[]} maxHR={200} />);
  expect(getByText('activity.noHeartRateData')).toBeTruthy();
});
