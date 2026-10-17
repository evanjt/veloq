/**
 * Scenario: a row of selector chips sized to their labels, as the section page's plot and
 * direction switches use, has more options or longer labels than the width holds.
 * Expected behaviour: each option is the shared chip carrying its selected state, a press reports
 * its value, and the row scrolls sideways rather than clipping a chip or cutting a label.
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ToggleButtonRow } from '@/shared/ui/Button';
import { colors, spacing } from '@/theme';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const OPTIONS = [
  { value: 'a', label: 'Alpha', testID: 'chip-a' },
  { value: 'b', label: 'Beta', testID: 'chip-b' },
] as const;

const LONG_OPTIONS = [
  { value: 'one', label: 'Tidal range over the season', testID: 'chip-one' },
  { value: 'two', label: 'Salinity by depth', testID: 'chip-two' },
  { value: 'three', label: 'Plankton bloom calendar', testID: 'chip-three' },
  { value: 'four', label: 'Current speed', testID: 'chip-four' },
  { value: 'five', label: 'Kelp cover', testID: 'chip-five' },
] as const;

describe('ToggleButtonRow sized to its labels', () => {
  it('marks exactly the chosen option selected', async () => {
    const { getByTestId } = await render(
      <ToggleButtonRow layout="hug" options={OPTIONS} value="b" onValueChange={() => {}} />
    );

    expect(getByTestId('chip-a').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('chip-b').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('chip-a').props.accessibilityRole).toBe('button');
  });

  it('reports the value of the pressed chip', async () => {
    const onValueChange = jest.fn();
    const { getByTestId } = await render(
      <ToggleButtonRow layout="hug" options={OPTIONS} value="a" onValueChange={onValueChange} />
    );

    await fireEvent.press(getByTestId('chip-b'));

    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('draws a chip, not a bordered button', async () => {
    const { getByTestId } = await render(
      <ToggleButtonRow layout="hug" options={OPTIONS} value="a" onValueChange={() => {}} />
    );

    const selected = StyleSheet.flatten(getByTestId('chip-a').props.style);
    const unselected = StyleSheet.flatten(getByTestId('chip-b').props.style);

    expect(unselected.borderColor).toBe('transparent');
    expect(selected.borderColor).not.toBe(colors.controlBoundary);
    expect(unselected.backgroundColor).toBe(colors.fillNeutral);
  });

  it('keys an option that stands for a series by its mark, on the standard selected fill', async () => {
    const { getByTestId } = await render(
      <ToggleButtonRow
        layout="hug"
        options={[
          { value: 'a', label: 'Alpha', mark: '#2E8B57', testID: 'chip-a' },
          { value: 'b', label: 'Beta', mark: '#8B2E5A', testID: 'chip-b' },
        ]}
        value="a"
        onValueChange={() => {}}
      />
    );

    expect(StyleSheet.flatten(getByTestId('chip-a-mark').props.style).backgroundColor).toBe(
      '#2E8B57'
    );
    expect(StyleSheet.flatten(getByTestId('chip-b-mark').props.style).backgroundColor).toBe(
      '#8B2E5A'
    );
    expect(StyleSheet.flatten(getByTestId('chip-a').props.style).backgroundColor).toBe(
      colors.controlOn
    );
  });

  it('draws a selected option in its accent pair', async () => {
    const { getByTestId } = await render(
      <ToggleButtonRow
        layout="hug"
        options={[
          { value: 'a', label: 'Alpha', accent: { fill: '#123456', ink: '#FFFFFF' }, testID: 'a' },
          { value: 'b', label: 'Beta', testID: 'b' },
        ]}
        value="a"
        onValueChange={() => {}}
      />
    );

    expect(StyleSheet.flatten(getByTestId('a').props.style).backgroundColor).toBe('#123456');
  });

  it('scrolls sideways with every chip sized to its label, so none is clipped', async () => {
    const screen = await render(
      <ToggleButtonRow layout="hug" options={LONG_OPTIONS} value="one" onValueChange={() => {}} />
    );

    const scroller = screen.UNSAFE_getByType(ScrollView);
    expect(scroller.props.horizontal).toBe(true);
    const content = StyleSheet.flatten(scroller.props.contentContainerStyle);
    expect(content.flexDirection).toBe('row');
    expect(content.gap).toBe(spacing.sm);
    for (const option of LONG_OPTIONS) {
      expect(
        StyleSheet.flatten(screen.getByTestId(option.testID).props.style).flex
      ).toBeUndefined();
    }
  });

  it('keeps the equal-width layout as the default, with no scroller', async () => {
    const screen = await render(
      <ToggleButtonRow options={OPTIONS} value="a" onValueChange={() => {}} />
    );

    expect(screen.UNSAFE_queryByType(ScrollView)).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('chip-a').props.style).flex).toBe(1);
  });
});
