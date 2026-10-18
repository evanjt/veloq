/**
 * Scenario: a strap reports a zone 7 heart rate in the dark theme.
 * Expected behaviour: the tile is tinted from the dark zone fill, the same
 * step the zone chips elsewhere draw, not from the light ladder.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { colorWithOpacity, opacity } from '@/theme';
import { zoneColour } from '@/theme/zoneColour';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: true, colors: { text: '#FFFFFF', textSecondary: '#A0A0A0' } }),
}));

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 192,
  power: 0,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

function tileStyle(tree: Awaited<ReturnType<typeof render>>) {
  const style = tree.getByTestId('data-field-heartrate').props.style;
  return Object.assign({}, ...[style].flat(5).filter(Boolean));
}

it('tints the heart rate tile from the dark zone fill', async () => {
  const tree = await render(
    <DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric hrZone={{ zone: 7 }} />
  );
  expect(tileStyle(tree).backgroundColor).toBe(
    colorWithOpacity(zoneColour(7, true), opacity.tint3)
  );
  expect(zoneColour(7, true)).not.toBe(zoneColour(7, false));
});

it('takes the nearer end of the ladder for a zone past it', async () => {
  const tree = await render(
    <DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric hrZone={{ zone: 9 }} />
  );
  expect(tileStyle(tree).backgroundColor).toBe(
    colorWithOpacity(zoneColour(7, true), opacity.tint3)
  );
});

it('leaves the tile untinted when no zone is known', async () => {
  const tree = await render(<DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric />);
  expect(tileStyle(tree).backgroundColor).not.toBe(
    colorWithOpacity(zoneColour(7, true), opacity.tint3)
  );
});
