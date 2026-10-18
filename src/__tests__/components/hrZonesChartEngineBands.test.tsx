/**
 * Scenario: the saved activity chart built its bands and bucketed the stream in
 * TypeScript, from sport settings it read itself.
 * Expected behaviour: it draws exactly the bands and times the activity detail
 * read resolved.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { HRZonesChart } from '@/features/activity/components/HRZonesChart';
import { typography } from '@/theme';
import { MaxHrSource } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const bands = [
  { zone: 1, minBpm: 0, maxBpm: 140, seconds: 90, percent: 75, share: 75 },
  { zone: 2, minBpm: 140, maxBpm: 155, seconds: 30, percent: 25, share: 25 },
  { zone: 3, minBpm: 155, maxBpm: 170, seconds: 0, percent: 0, share: 0 },
  { zone: 4, minBpm: 170, maxBpm: 185, seconds: 0, percent: 0, share: 0 },
  { zone: 5, minBpm: 185, maxBpm: 200, seconds: 0, percent: 0, share: 0 },
];

it('renders the engine bands and times as given', async () => {
  const { getByText, queryByText } = await render(
    <HRZonesChart hrZones={bands} maxHR={200} movingTime={120} />
  );

  expect(getByText('Z1')).toBeTruthy();
  expect(getByText('75%')).toBeTruthy();
  expect(getByText('25%')).toBeTruthy();
  expect(getByText('0-140 bpm')).toBeTruthy();
  expect(getByText('140-155 bpm')).toBeTruthy();
  expect(getByText('185-200 bpm')).toBeTruthy();
  expect(queryByText('Z6')).toBeNull();
});

it('shows the placeholder when the engine has no zone time', async () => {
  const { getByText } = await render(<HRZonesChart hrZones={[]} maxHR={200} movingTime={120} />);
  expect(getByText('activity.noHeartRateData')).toBeTruthy();
});

it('shows zone time with heart rate beside a different moving time', async () => {
  const differingBands = [
    { ...bands[0], seconds: 3000 },
    { ...bands[1], seconds: 985 },
  ];
  const { getByText } = await render(
    <HRZonesChart hrZones={differingBands} maxHR={200} movingTime={4090} />
  );

  // The total and the moving time are written as the bands are, in hours and
  // minutes, rather than as a clock beside them.
  expect(getByText('activity.hrZoneTotal:{"duration":"1 h 6 min"}')).toBeTruthy();
  expect(getByText('activity.movingTime:{"duration":"1 h 8 min"}')).toBeTruthy();
  expect(getByText('50 min')).toBeTruthy();
});

it('titles the card as a header in the card title role, with the max HR beside it', () => {
  const { getByRole, getByText } = render(
    <HRZonesChart
      hrZones={bands}
      maxHR={200}
      maxHrSource={MaxHrSource.SportSettings}
      movingTime={120}
    />
  );

  const title = getByRole('header', { name: 'activity.timeInHRZones' });
  const style = StyleSheet.flatten(title.props.style);
  expect(style.fontSize).toBe(typography.cardTitle.fontSize);
  expect(style.fontWeight).toBe(typography.cardTitle.fontWeight);
  expect(getByText('activity.zoneMaxFromSettings:{"value":200}')).toBeTruthy();
});
