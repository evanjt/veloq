/**
 * Scenario: a strap reports a zone 4 heart rate.
 * Expected behaviour: the tile is washed in the zone's tint, faint in light and
 * one step stronger in dark, the number is set in primary text, and the zone
 * name sits beside a dot in the zone's fill, never set in a zone colour itself.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { colors, colorWithOpacity, darkColors, opacity } from '@/theme';
import { zoneColour, zoneTint } from '@/theme/zoneColour';

let mockDark = false;
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => {
    const theme = jest.requireActual('@/theme');
    const palette = mockDark ? theme.darkColors : theme.colors;
    return {
      isDark: mockDark,
      colors: { text: palette.textPrimary, textSecondary: palette.textSecondary },
    };
  },
}));

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 165,
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

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(5).filter(Boolean));
}

describe.each([
  ['light', false, opacity.tint2],
  ['dark', true, opacity.tint3],
])('a zoned heart rate tile in %s', (_name, isDark, alpha) => {
  beforeEach(() => {
    mockDark = isDark;
  });

  it('washes the tile in the zone tint', async () => {
    const tree = await render(
      <DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric hrZone={{ zone: 4 }} />
    );
    const tint = flat(tree.getByTestId('data-field-heartrate').props.style).backgroundColor;
    expect(tint).toBe(zoneTint(4, isDark));
    expect(tint).toBe(colorWithOpacity(zoneColour(4, isDark), alpha));
  });

  it('sets the value and the zone name in primary text, keyed by a zone dot', async () => {
    const tree = await render(
      <DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric hrZone={{ zone: 4 }} />
    );
    const ink = (isDark ? darkColors : colors).textPrimary;
    const tile = tree.getByTestId('data-field-heartrate');
    const value = tile.findAll((n) => n.children[0] === '165 bpm')[0];
    expect(flat(value.props.style).color).toBe(ink);
    const name = tile.findAll((n) => n.children[0] === 'Z4')[0];
    expect(flat(name.props.style).color).toBe(ink);
    const dot = tree.getByTestId('data-field-heartrate-zone-dot');
    expect(flat(dot.props.style).backgroundColor).toBe(zoneColour(4, isDark));
  });
});

it('draws no zone dot when no zone is known', async () => {
  mockDark = false;
  const tree = await render(<DataFieldGrid fields={['heartrate']} metrics={METRICS} isMetric />);
  expect(tree.queryByTestId('data-field-heartrate-zone-dot')).toBeNull();
});
