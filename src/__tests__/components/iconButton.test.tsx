/**
 * Scenario: icon-only actions were hand-rolled with a glyph-sized press target and no name.
 *
 * Expected behaviour: `IconButton` reaches the platform tap-target minimum, its drawn square
 * plus hit slop, whatever the glyph size, carries its label to the accessibility tree, and refuses a press
 * while disabled. A toggle that is on fills the control on blue under a white glyph and says so to a
 * screen reader, and an idle glyph takes the secondary icon ink without the caller choosing it.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';

import { IconButton, iconButtonSkin } from '@/shared/ui/IconButton';
import { colors, darkColors, layout } from '@/theme';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

function flatten(style: unknown): Record<string, number | string> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<
    string,
    number | string
  >;
}

describe('IconButton', () => {
  it('reaches the tap-target minimum square around a small glyph', async () => {
    const { getByTestId } = await render(
      <IconButton accessibilityLabel="Rename" onPress={() => {}} testID="i">
        <Text>x</Text>
      </IconButton>
    );
    const node = getByTestId('i');
    const style = flatten(node.props.style);
    const slop = node.props.hitSlop;
    expect(Number(style.minWidth) + slop.left + slop.right).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
    expect(Number(style.minHeight) + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      layout.minTapTarget
    );
  });

  it('reaches the accessibility tree as a named button', async () => {
    const { getByRole } = await render(
      <IconButton accessibilityLabel="Rename" onPress={() => {}}>
        <Text>x</Text>
      </IconButton>
    );
    expect(getByRole('button', { name: 'Rename' })).toBeTruthy();
  });

  it('presses, and refuses a press while disabled', async () => {
    const onPress = jest.fn();
    const { getByTestId, rerender } = await render(
      <IconButton accessibilityLabel="Back" onPress={onPress} testID="i">
        <Text>x</Text>
      </IconButton>
    );
    await fireEvent.press(getByTestId('i'));
    expect(onPress).toHaveBeenCalledTimes(1);

    await rerender(
      <IconButton accessibilityLabel="Back" onPress={onPress} disabled testID="i">
        <Text>x</Text>
      </IconButton>
    );
    await fireEvent.press(getByTestId('i'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes the Button variant ground', async () => {
    const { getByTestId } = await render(
      <IconButton accessibilityLabel="Go" variant="primary" onPress={() => {}} testID="i">
        <Text>x</Text>
      </IconButton>
    );
    expect(flatten(getByTestId('i').props.style).backgroundColor).toBe(colors.actionPrimary);
  });
});

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('iconButtonSkin', () => {
  it.each([
    ['light', false, colors],
    ['dark', true, darkColors],
  ] as const)(
    'fills a selected toggle with the on state under white in %s',
    (_, isDark, palette) => {
      for (const variant of ['ghost', 'secondary', 'primary'] as const) {
        const skin = iconButtonSkin({ variant, selected: true, isDark });
        expect(skin.backgroundColor).toBe(palette.controlOn);
        expect(skin.glyph).toBe(colors.textOnFill);
        expect(contrastRatio(skin.glyph, skin.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      }
    }
  );

  it.each([
    ['light', false, colors],
    ['dark', true, darkColors],
  ] as const)(
    'draws an unselected toggle on the secondary ground with the secondary icon ink in %s',
    (_, isDark, palette) => {
      const skin = iconButtonSkin({ variant: 'secondary', selected: false, isDark });
      expect(skin.backgroundColor).toBe(palette.surface);
      expect(skin.glyph).toBe(palette.iconSecondary);
      expect(iconButtonSkin({ variant: 'ghost', isDark }).glyph).toBe(palette.iconSecondary);
    }
  );

  it('keeps white on the filled variants', () => {
    expect(iconButtonSkin({ variant: 'primary', isDark: false }).glyph).toBe(colors.textOnFill);
    expect(iconButtonSkin({ variant: 'destructive', isDark: true }).glyph).toBe(colors.textOnFill);
  });
});

describe('IconButton selected', () => {
  it('reports the selected state and draws the on ground with a white glyph', async () => {
    const { getByTestId, UNSAFE_getByType } = await render(
      <IconButton accessibilityLabel="Terrain" variant="secondary" selected testID="i">
        <IconButton.Glyph name="terrain" />
      </IconButton>
    );
    const node = getByTestId('i');
    expect(node.props.accessibilityState).toMatchObject({ selected: true });
    expect(flatten(node.props.style).backgroundColor).toBe(colors.controlOn);
    expect(UNSAFE_getByType(MaterialCommunityIcons).props.color).toBe(colors.textOnFill);
  });

  it('reports unselected and gives the glyph the secondary icon ink', async () => {
    const { getByTestId, UNSAFE_getByType } = await render(
      <IconButton accessibilityLabel="Terrain" variant="secondary" selected={false} testID="i">
        <IconButton.Glyph name="terrain" />
      </IconButton>
    );
    expect(getByTestId('i').props.accessibilityState).toMatchObject({ selected: false });
    expect(UNSAFE_getByType(MaterialCommunityIcons).props.color).toBe(colors.iconSecondary);
  });

  it('leaves the selected state out of a plain action', async () => {
    const { getByTestId } = await render(
      <IconButton accessibilityLabel="Share" testID="i">
        <IconButton.Glyph name="share-variant" />
      </IconButton>
    );
    expect(getByTestId('i').props.accessibilityState.selected).toBeUndefined();
  });
});

describe('IconButton selected over a caller ground', () => {
  it('keeps the on fill when the caller paints its own ground', async () => {
    const { getByTestId } = await render(
      <IconButton
        accessibilityLabel="Terrain"
        variant="secondary"
        selected
        style={{ backgroundColor: darkColors.surfaceRaised }}
        testID="i"
      >
        <IconButton.Glyph name="terrain" />
      </IconButton>
    );
    expect(flatten(getByTestId('i').props.style).backgroundColor).toBe(colors.controlOn);
  });
});
