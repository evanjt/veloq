/**
 * Scenario: a settings switch drawn beside a label in a plain view is two focus
 * stops, the switch read as "switch, off" with no name, and a tap on the label
 * does nothing.
 *
 * Expected behaviour: the row is one element with the switch role, named by its
 * title and described by its description, that toggles from a tap anywhere on it
 * with one selection haptic. The switch inside it is hidden from assistive
 * technology so it is not a second stop, and still toggles from its own thumb.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Switch as PaperSwitch } from 'react-native-paper';

import { Switch, SwitchRow, switchColors } from '@/shared/ui';
import { colors, colorWithOpacity, darkColors, opacity, switchTrackOff } from '@/theme';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

beforeEach(() => {
  jest.clearAllMocks();
});

async function renderRow(props: Partial<React.ComponentProps<typeof SwitchRow>> = {}) {
  const onValueChange = jest.fn();
  await render(
    <SwitchRow
      title="Night lights"
      description="Turns the porch lamp on at dusk."
      value={false}
      onValueChange={onValueChange}
      testID="night-lights"
      {...props}
    />
  );
  return onValueChange;
}

/** The opacity an element is drawn at: its own and every host ancestor's, multiplied. */
function drawnOpacity(element: ReturnType<typeof screen.getByTestId>): number {
  let product = 1;
  for (let node: typeof element | null = element; node; node = node.parent) {
    if (typeof node.type !== 'string') continue;
    const own = StyleSheet.flatten(node.props.style)?.opacity;
    if (typeof own === 'number') product *= own;
  }
  return product;
}

describe('SwitchRow', () => {
  it('is one switch element named by its title and described by its description', async () => {
    await renderRow();

    const row = screen.getByRole('switch', { name: 'Night lights' });
    expect(row).toBe(screen.getByTestId('night-lights'));
    expect(row.props.accessibilityHint).toBe('Turns the porch lamp on at dusk.');
    expect(row).not.toBeChecked();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('reads as on when its value is on', async () => {
    await renderRow({ value: true });

    expect(screen.getByRole('switch', { name: 'Night lights' })).toBeChecked();
  });

  it('flips from a tap on the title, with one selection haptic', async () => {
    const onValueChange = await renderRow({ value: true });

    await fireEvent.press(screen.getByText('Night lights'));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(false);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('flips from its own thumb with one selection haptic', async () => {
    const onValueChange = await renderRow();
    const thumb = screen.UNSAFE_getByType(PaperSwitch);

    thumb.props.onValueChange(true);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, and says so', async () => {
    const onValueChange = await renderRow({ disabled: true });

    const row = screen.getByRole('switch', { name: 'Night lights' });
    expect(row).toBeDisabled();
    await fireEvent.press(row);

    expect(onValueChange).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('draws a disabled row at the disabled step over its own label colours', async () => {
    await renderRow({ disabled: true, titleTestID: 'night-lights-title' });

    const title = screen.getByTestId('night-lights-title');
    expect(StyleSheet.flatten(title.props.style).color).toBe(colors.textPrimary);
    expect(drawnOpacity(title)).toBe(opacity.disabled);
  });

  it('draws an enabled row at full strength', async () => {
    await renderRow({ titleTestID: 'night-lights-title' });

    expect(drawnOpacity(screen.getByTestId('night-lights-title'))).toBe(1);
  });

  it('flips again on the second tap from the value it is given', async () => {
    const onValueChange = jest.fn();
    const { rerender } = await render(
      <SwitchRow title="Night lights" value={false} onValueChange={onValueChange} />
    );
    await fireEvent.press(screen.getByRole('switch', { name: 'Night lights' }));
    await rerender(<SwitchRow title="Night lights" value onValueChange={onValueChange} />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Night lights' }));

    expect(onValueChange.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps an accessory reachable as its own element', async () => {
    await renderRow({
      accessory: (
        <Text accessibilityRole="button" accessibilityLabel="About night lights">
          i
        </Text>
      ),
    });

    expect(screen.getByRole('button', { name: 'About night lights' })).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});

describe('Switch', () => {
  it('carries its name and fires one selection haptic per change', async () => {
    const onValueChange = jest.fn();
    await render(
      <Switch value={false} onValueChange={onValueChange} accessibilityLabel="Hide clouds" />
    );

    const control = screen.getByRole('switch', { name: 'Hide clouds' });
    await fireEvent(control, 'valueChange', true);

    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('switch colours', () => {
  it('tints only the on track on iOS, from the theme primary, and leaves the thumb to the system', () => {
    expect(switchColors(false, true, 'ios')).toEqual({ trackColor: { true: colors.primary } });
    expect(switchColors(true, false, 'ios')).toEqual({ trackColor: { true: darkColors.primary } });
  });

  it('draws the Android off track with the mark tone of each theme', () => {
    expect(switchColors(false, false, 'android').trackColor.false).toBe(switchTrackOff.light);
    expect(switchColors(true, false, 'android').trackColor.false).toBe(switchTrackOff.dark);
  });

  it('draws the Android on state from the primary of each theme', () => {
    expect(switchColors(false, true, 'android')).toEqual({
      thumbColor: colors.primary,
      trackColor: { true: colorWithOpacity(colors.primary, 0.5), false: switchTrackOff.light },
    });
    expect(switchColors(true, true, 'android').thumbColor).toBe(darkColors.primary);
  });
});
