/**
 * Scenario: a strap reports a zone 3 heart rate in the light theme.
 * Expected behaviour: the tile is tinted in the zone fill but the number is
 * drawn in the zone's text tone, not the fill.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { hrZoneTextColor } from '@/features/recording/lib/hrZoneTextColor';
import { zoneColors } from '@/theme/colors';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 145,
  power: 0,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  pace: 200,
  avgPace: 200,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

it('draws the heart rate number in the zone text tone, not the zone fill', () => {
  const tree = render(
    <DataFieldGrid
      fields={['heartrate']}
      metrics={METRICS}
      isMetric
      hrZone={{ zone: 3, color: zoneColors.zone3 }}
    />
  );
  const value = tree
    .getByTestId('data-field-heartrate')
    .findAll((n) => n.children[0] === '145 bpm')[0];
  const flat = Object.assign({}, ...[value.props.style].flat(3).filter(Boolean));
  expect(flat.color).toBe(hrZoneTextColor(3, false));
  expect(flat.color).not.toBe(zoneColors.zone3);
});
