/**
 * Scenario: riding at 450 m, the GPS stops reporting altitude. The current
 * altitude tile must not invent sea level for a reading that does not exist.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { ABSENT } from '@/shared/format/absent';

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

async function tile(elevation: number | null, isMetric = true): Promise<string> {
  const tree = await render(
    <DataFieldGrid fields={['elevation']} metrics={{ ...METRICS, elevation }} isMetric={isMetric} />
  );
  return tree
    .getByTestId('data-field-elevation')
    .findAll((n) => typeof n.children[0] === 'string')[0].children[0] as string;
}

it('shows the absent mark, not 0 m, when there is no altitude reading', async () => {
  expect(await tile(null)).toBe(ABSENT);
  expect(await tile(null, false)).toBe(ABSENT);
});

it('shows a real reading, sea level included', async () => {
  expect(await tile(450)).toBe('450 m');
  expect(await tile(0)).toBe('0 m');
});
