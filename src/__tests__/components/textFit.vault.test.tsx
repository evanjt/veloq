/**
 * Scenario: a single-line Text cuts a number or a name off with an ellipsis at
 * a narrow width or a large system text size, and a grid laid out in fixed
 * columns keeps them at every size, so the value inside each cell is what goes.
 *
 * Expected behaviour: numbers and control labels shrink to three quarters of
 * their size before anything is cut, names wrap to two lines and keep their
 * full text for a screen reader, and the dense grids drop columns once the text
 * is past the dense cap.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { FIT_MIN_FONT_SCALE, FitText } from '@/shared/ui/FitText';
import { NameText } from '@/shared/ui/NameText';
import { columnsAtTextScale } from '@/shared/ui/useLargeText';
import { StatCard } from '@/features/activity/components/stats/StatCard';
import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockDimensions = jest.fn();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockDimensions(),
}));

function windowAt(fontScale: number) {
  mockDimensions.mockReturnValue({ width: 360, height: 780, scale: 3, fontScale });
}

beforeEach(() => windowAt(1));

/** A Pressable's style, resolved at rest. */
function widthOf(style: unknown): unknown {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved).width;
}

/** How many cells of a percentage width fit side by side in a row. */
function perRow(width: unknown): number {
  const percent = parseFloat(String(width));
  return Math.floor(100 / percent);
}

describe('FitText', () => {
  it('shrinks to fit on one line, down to three quarters of its size', async () => {
    const tree = await render(<FitText>12:34:56</FitText>);
    const text = tree.UNSAFE_getByType(Text);
    expect(text.props.adjustsFontSizeToFit).toBe(true);
    expect(text.props.minimumFontScale).toBe(0.75);
    expect(FIT_MIN_FONT_SCALE).toBe(0.75);
    expect(text.props.numberOfLines).toBe(1);
  });

  it('keeps a cap a dense surface passes it', async () => {
    const tree = await render(<FitText maxFontSizeMultiplier={1.3}>42 km</FitText>);
    expect(tree.UNSAFE_getByType(Text).props.maxFontSizeMultiplier).toBe(1.3);
  });
});

describe('NameText', () => {
  const name = 'Morning loop past the harbour lighthouse and back over the ridge';

  it('wraps to two lines, then ends in an ellipsis', async () => {
    const tree = await render(<NameText>{name}</NameText>);
    const text = tree.UNSAFE_getByType(Text);
    expect(text.props.numberOfLines).toBe(2);
    expect(text.props.ellipsizeMode).toBe('tail');
  });

  it('gives a screen reader the whole name', async () => {
    const tree = await render(<NameText>{name}</NameText>);
    expect(tree.UNSAFE_getByType(Text).props.accessibilityLabel).toBe(name);
  });

  it('lets a caller name it differently', async () => {
    const tree = await render(<NameText accessibilityLabel="Lighthouse loop">{name}</NameText>);
    expect(tree.UNSAFE_getByType(Text).props.accessibilityLabel).toBe('Lighthouse loop');
  });
});

describe('columnsAtTextScale', () => {
  it('keeps every column up to the dense cap', () => {
    expect(columnsAtTextScale(3, 1)).toBe(3);
    expect(columnsAtTextScale(3, 1.3)).toBe(3);
  });

  it('drops one column past the cap, and to one past double', () => {
    expect(columnsAtTextScale(3, 1.31)).toBe(2);
    expect(columnsAtTextScale(3, 2)).toBe(2);
    expect(columnsAtTextScale(3, 2.01)).toBe(1);
    expect(columnsAtTextScale(2, 1.5)).toBe(1);
    expect(columnsAtTextScale(1, 3)).toBe(1);
  });
});

async function statCardWidth() {
  const tree = await render(
    <StatCard
      stat={{
        title: 'Distance',
        value: '44.2',
        unit: 'km',
        icon: 'map-marker-distance',
      }}
      isDark={false}
      onPress={() => {}}
    />
  );
  return widthOf(tree.getByRole('button').props.style);
}

describe('the activity stats grid', () => {
  it('lays three cards to a row at the default size', async () => {
    windowAt(1);
    expect(perRow(await statCardWidth())).toBe(3);
  });

  it('lays two or fewer to a row at double text on a 360 wide window', async () => {
    windowAt(2);
    expect(perRow(await statCardWidth())).toBeLessThanOrEqual(2);
  });

  it('lays one to a row past double', async () => {
    windowAt(3);
    expect(perRow(await statCardWidth())).toBe(1);
  });
});

describe('the recording field grid', () => {
  async function tileWidth() {
    const tree = await render(
      <DataFieldGrid
        fields={['speed', 'distance']}
        metrics={{ speed: 8, distance: 1200, heartrate: 0, power: 0, cadence: 0 } as never}
        isMetric
        activityType="Ride"
      />
    );
    return widthOf(tree.getByTestId('data-field-speed').props.style);
  }

  it('lays two tiles to a row at the default size', async () => {
    windowAt(1);
    expect(perRow(await tileWidth())).toBe(2);
  });

  it('gives each tile the full width past the dense cap', async () => {
    windowAt(2);
    expect(perRow(await tileWidth())).toBe(1);
  });
});
