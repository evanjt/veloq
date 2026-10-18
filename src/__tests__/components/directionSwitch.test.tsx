/**
 * Scenario: a section or route ridden both ways switches its charts between the
 * two directions, and the direction control read as a second row of the plot
 * toggle above it, with no count to say how many attempts each side holds.
 *
 * Expected behaviour: one grey segmented track with a segment per direction,
 * each showing its word and the engine's count, the chosen one selected for a
 * screen reader. A press on the other segment reports it once with a selection
 * tick; a press on the chosen one does nothing. With either side empty there is
 * nothing to switch, so nothing is drawn.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import * as haptics from '@/shared/ui/haptics';
import { DirectionSwitch } from '@/shared/ui';
import { colors } from '@/theme';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const MARKS = { forward: '#111111', reverse: '#222222' };

function switchOf(props: Partial<React.ComponentProps<typeof DirectionSwitch>> = {}) {
  return (
    <DirectionSwitch
      value="forward"
      counts={{ forward: 12, reverse: 4 }}
      marks={MARKS}
      onChange={jest.fn()}
      testID="dir"
      {...props}
    />
  );
}

describe('DirectionSwitch', () => {
  afterEach(() => jest.clearAllMocks());

  it('draws each direction with its count, the chosen one selected', async () => {
    const tree = await render(switchOf());

    const forward = tree.getByTestId('dir-forward');
    const reverse = tree.getByTestId('dir-reverse');
    expect(forward).toHaveTextContent(/sections\.forward.*12/);
    expect(reverse).toHaveTextContent(/sections\.reverse.*4/);
    expect(forward.props.accessibilityState.selected).toBe(true);
    expect(reverse.props.accessibilityState.selected).toBe(false);
    expect(forward.props.accessibilityLabel).toContain('12');
    expect(reverse.props.accessibilityLabel).toContain('4');
    expect(['tab', 'radio']).toContain(forward.props.accessibilityRole);
  });

  it('keys each segment with its direction colour', async () => {
    const tree = await render(switchOf());

    expect(StyleSheet.flatten(tree.getByTestId('dir-forward-mark').props.style)).toMatchObject({
      backgroundColor: MARKS.forward,
    });
    expect(StyleSheet.flatten(tree.getByTestId('dir-reverse-mark').props.style)).toMatchObject({
      backgroundColor: MARKS.reverse,
    });
  });

  it('draws a grey track, not a blue chip', async () => {
    const tree = await render(switchOf());

    const track = StyleSheet.flatten(tree.getByTestId('dir').props.style);
    expect(track.backgroundColor).toBe(colors.fillNeutral);
    for (const id of ['dir-forward', 'dir-reverse']) {
      const segment = StyleSheet.flatten(tree.getByTestId(id).props.style);
      expect(segment.backgroundColor).not.toBe(colors.controlOn);
    }
  });

  it('keeps each segment as wide as its word in a row parent', async () => {
    const tree = await render(<View style={{ flexDirection: 'row' }}>{switchOf()}</View>);

    // In a row the track sizes to its content, so a segment with a zero basis
    // contributes no width and its word and count collapse to nothing.
    for (const id of ['dir-forward', 'dir-reverse']) {
      const segment = StyleSheet.flatten(tree.getByTestId(id).props.style);
      expect(segment.flex).toBeUndefined();
      expect(segment.flexBasis ?? 'auto').toBe('auto');
      expect(segment.flexGrow).toBe(1);
      expect(segment.flexShrink).toBe(1);
    }
  });

  it('reports the other direction once with a selection tick', async () => {
    const onChange = jest.fn();
    const tree = await render(switchOf({ onChange }));

    await fireEvent.press(tree.getByTestId('dir-reverse'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('reverse');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the chosen direction is pressed again', async () => {
    const onChange = jest.fn();
    const tree = await render(switchOf({ onChange }));

    await fireEvent.press(tree.getByTestId('dir-forward'));
    expect(onChange).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it.each([
    ['reverse', { forward: 12, reverse: 0 }],
    ['forward', { forward: 0, reverse: 4 }],
    ['both', { forward: 0, reverse: 0 }],
  ])('draws nothing when %s is empty', async (_name, counts) => {
    const tree = await render(switchOf({ counts }));

    expect(tree.queryByTestId('dir')).toBeNull();
    expect(tree.queryByTestId('dir-forward')).toBeNull();
    expect(tree.queryByTestId('dir-reverse')).toBeNull();
  });
});
