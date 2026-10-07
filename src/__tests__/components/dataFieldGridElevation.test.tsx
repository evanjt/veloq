/**
 * Scenario: riding at 450 m, the GPS stops reporting altitude. The current
 * altitude tile must not invent sea level for a reading that does not exist.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 0,
  power: 0,
  cadence: 0,
  elevation: 450 as number | null,
  elevationGain: 20,
  pace: 200,
  avgPace: 200,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

function tile(elevation: number | null, isMetric = true): string {
  const tree = render(
    <DataFieldGrid fields={['elevation']} metrics={{ ...METRICS, elevation }} isMetric={isMetric} />
  );
  return tree
    .getByTestId('data-field-elevation')
    .findAll((n) => typeof n.children[0] === 'string')[0].children[0] as string;
}

it('shows a placeholder, not 0 m, when there is no altitude reading', () => {
  expect(tile(null)).toBe('-- m');
  expect(tile(null, false)).toBe('-- ft');
});

it('shows a real reading, sea level included', () => {
  expect(tile(450)).toBe('450 m');
  expect(tile(0)).toBe('0 m');
});
