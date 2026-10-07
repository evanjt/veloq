/**
 * Scenario: the section page picks between options with one compact control.
 * Expected behaviour: each option is a chip button carrying its selected state,
 * a press reports its value, and no chip draws the heavy bordered button box.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ChipSelector } from '@/shared/ui/ChipSelector';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
] as const;

describe('ChipSelector', () => {
  it('marks exactly the chosen option selected', () => {
    const { getByTestId } = render(
      <ChipSelector
        options={OPTIONS}
        value="b"
        onChange={() => {}}
        optionTestID={(v) => `chip-${v}`}
      />
    );

    expect(getByTestId('chip-a').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('chip-b').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('chip-a').props.accessibilityRole).toBe('button');
  });

  it('reports the value of the pressed chip', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <ChipSelector
        options={OPTIONS}
        value="a"
        onChange={onChange}
        optionTestID={(v) => `chip-${v}`}
      />
    );

    fireEvent.press(getByTestId('chip-b'));

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('draws a chip, not a bordered button', () => {
    const { getByTestId } = render(
      <ChipSelector
        options={OPTIONS}
        value="a"
        onChange={() => {}}
        optionTestID={(v) => `chip-${v}`}
      />
    );

    const style = StyleSheet.flatten(getByTestId('chip-a').props.style);

    expect(style.borderWidth).toBeUndefined();
  });
});
