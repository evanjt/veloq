/**
 * Scenario: a value over a label was drawn by hand at each site, each with its own
 * size, weight, colour and figure style, and a change stated by colour alone.
 *
 * Expected behaviour: one `StatTile` draws the value, its unit, the label, a delta
 * and a caption from props. The delta carries a glyph and words beside its tone, the
 * value is a standalone figure in proportional digits, and every line takes the dense
 * cap and wraps rather than clipping.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { StatTile } from '@/shared/ui/StatTile';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { colors, darkColors, typography, verdictColor } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

afterEach(() => {
  mockIsDark = false;
});

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) ?? {};

describe('StatTile', () => {
  it('draws the value, unit, label, delta and caption it is given', async () => {
    const view = await render(
      <StatTile
        testID="tile"
        label="Distance"
        value="44.2"
        unit="km"
        delta={{ glyph: '↑', text: '12%', tone: 'positive', spoken: 'Up' }}
        caption="vs last week"
      />
    );

    expect(view.getByTestId('tile-value').props.children).toContain('44.2');
    expect(view.getByText('km')).toBeTruthy();
    expect(view.getByText('Distance')).toBeTruthy();
    expect(view.getByText('vs last week')).toBeTruthy();
    expect(view.getByTestId('tile-delta')).toBeTruthy();
  });

  it('states the delta with a glyph and words beside its tone, never the colour alone', async () => {
    const view = await render(
      <StatTile
        testID="tile"
        label="Load"
        value="410"
        delta={{ glyph: '↓', text: '8%', tone: 'negative', spoken: 'Down' }}
      />
    );
    const delta = view.getByTestId('tile-delta');

    expect(delta).toHaveTextContent('↓ 8%');
    expect(flat(delta).color).toBe(verdictColor('negative', false));
    expect(delta.props.accessibilityLabel).toBe('Down, 8%');
  });

  it('speaks a delta drawn as a glyph alone in words', async () => {
    const view = await render(
      <StatTile
        testID="tile"
        label="Load"
        value="410"
        delta={{ glyph: '→', tone: 'neutral', spoken: 'No change' }}
      />
    );
    const delta = view.getByTestId('tile-delta');

    expect(delta).toHaveTextContent('→');
    expect(delta.props.accessibilityLabel).toBe('No change');
  });

  it('draws the value in proportional figures, since a tile value never updates in place', async () => {
    const view = await render(<StatTile testID="tile" label="Distance" value="44.2" />);
    const value = flat(view.getByTestId('tile-value'));

    expect(value.fontVariant ?? []).not.toContain('tabular-nums');
    expect(value.fontSize).toBe(typography.statsValue.fontSize);
    expect(value.fontWeight).toBe(typography.statsValue.fontWeight);
  });

  it('draws the large value at the large stat size, still proportional', async () => {
    const view = await render(<StatTile testID="tile" size="lg" label="Count" value="7" />);
    const value = flat(view.getByTestId('tile-value'));

    expect(value.fontSize).toBe(typography.statsValueLarge.fontSize);
    expect(value.fontVariant ?? []).not.toContain('tabular-nums');
  });

  it('caps every line at 1.3 and lets none clip at that size', async () => {
    const view = await render(
      <StatTile
        testID="tile"
        label="A label long enough to wrap onto a second line at the cap"
        value="1,234,567"
        unit="kJ"
        delta={{ glyph: '↑', text: '120%', tone: 'positive', spoken: 'Up' }}
        caption="A caption long enough to wrap as well"
      />
    );
    const lines = view.UNSAFE_getAllByType(Text);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.props.maxFontSizeMultiplier).toBe(DENSE_TEXT_SCALE);
      expect(line.props.numberOfLines).toBeUndefined();
      expect(line.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it('draws the label and value in the dark theme roles', async () => {
    mockIsDark = true;
    const view = await render(<StatTile testID="tile" label="Distance" value="44.2" />);

    expect(flat(view.getByTestId('tile-value')).color).toBe(darkColors.textPrimary);
    expect(flat(view.getByText('Distance')).color).toBe(darkColors.textSecondary);
  });

  it('is one button when it takes a press, its label drawn as the action', async () => {
    const onPress = jest.fn();
    const view = await render(
      <StatTile testID="tile" label="Activities" value="490" onPress={onPress} />
    );
    const tile = view.getByTestId('tile');

    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe('Activities, 490');
    expect(flat(view.getByText('Activities')).color).toBe(colors.actionLink);
    fireEvent.press(tile);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws a disabled press as a plain label that takes no press', async () => {
    const onPress = jest.fn();
    const view = await render(
      <StatTile testID="tile" label="Routes" value="–" onPress={onPress} disabled />
    );

    expect(flat(view.getByText('Routes')).color).toBe(colors.textSecondary);
    fireEvent.press(view.getByTestId('tile'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reads as one element without a press, its parts in order', async () => {
    const view = await render(
      <StatTile
        testID="tile"
        label="Distance"
        value="44.2"
        unit="km"
        delta={{ glyph: '↑', text: '12%', tone: 'positive', spoken: 'Up' }}
        caption="vs last week"
      />
    );
    const tile = view.getByTestId('tile');

    expect(tile.props.accessible).toBe(true);
    expect(tile.props.accessibilityLabel).toBe('Distance, 44.2 km, Up, 12%, vs last week');
  });

  it('is no second stop inside a parent that already speaks it', async () => {
    const view = await render(
      <StatTile testID="tile" label="Distance" value="44.2" accessible={false} />
    );
    const tile = view.getByTestId('tile');

    expect(tile.props.accessible).toBe(false);
    expect(tile.props.accessibilityLabel).toBeUndefined();
  });
});
