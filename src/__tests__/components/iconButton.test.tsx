/**
 * Scenario: icon-only actions were hand-rolled with a glyph-sized press target and no name.
 *
 * Expected behaviour: `IconButton` reaches the platform tap-target minimum, its drawn square
 * plus hit slop, whatever the glyph size, carries its label to the accessibility tree, and refuses a press
 * while disabled.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { IconButton } from '@/shared/ui/IconButton';
import { colors, layout } from '@/theme';

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
  it('reaches the tap-target minimum square around a small glyph', () => {
    const { getByTestId } = render(
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

  it('reaches the accessibility tree as a named button', () => {
    const { getByRole } = render(
      <IconButton accessibilityLabel="Rename" onPress={() => {}}>
        <Text>x</Text>
      </IconButton>
    );
    expect(getByRole('button', { name: 'Rename' })).toBeTruthy();
  });

  it('presses, and refuses a press while disabled', () => {
    const onPress = jest.fn();
    const { getByTestId, rerender } = render(
      <IconButton accessibilityLabel="Back" onPress={onPress} testID="i">
        <Text>x</Text>
      </IconButton>
    );
    fireEvent.press(getByTestId('i'));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton accessibilityLabel="Back" onPress={onPress} disabled testID="i">
        <Text>x</Text>
      </IconButton>
    );
    fireEvent.press(getByTestId('i'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes the Button variant ground', () => {
    const { getByTestId } = render(
      <IconButton accessibilityLabel="Go" variant="primary" onPress={() => {}} testID="i">
        <Text>x</Text>
      </IconButton>
    );
    expect(flatten(getByTestId('i').props.style).backgroundColor).toBe(colors.primary);
  });
});
