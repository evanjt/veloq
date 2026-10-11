/**
 * Scenario: a numeric setting is stored in one unit and shown in another, between a lower and an
 * upper bound.
 *
 * Expected behaviour: `Stepper` is one adjustable element carrying its label and the formatted
 * value, its minus and plus are disabled at the bounds, a press moves to the next whole step of
 * the displayed unit, and the result is written back in the stored unit, clamped to the bounds.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Stepper, stepValue, type StepperScale } from '@/shared/ui/Stepper';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const LITRES: StepperScale = { perStored: 1, step: 5 };
/** Displays a stored litre count in half-litres, five at a press. */
const HALF_LITRES: StepperScale = { perStored: 2, step: 5 };

function setup(value: number, scale: StepperScale = LITRES) {
  const onChange = jest.fn();
  const view = render(
    <Stepper
      testID="tank"
      accessibilityLabel="Tank level"
      decrementLabel="Lower the tank level"
      incrementLabel="Raise the tank level"
      value={value}
      min={10}
      max={100}
      scale={scale}
      format={(v) => `${Math.round(v * scale.perStored)} L`}
      onChange={onChange}
    />
  );
  const act = (actionName: 'increment' | 'decrement') =>
    fireEvent(view.getByTestId('tank-value'), 'accessibilityAction', {
      nativeEvent: { actionName },
    });
  return { view, onChange, act };
}

describe('Stepper', () => {
  it('is one adjustable element whose value is the formatted reading', () => {
    const { view } = setup(100);
    const node = view.getByTestId('tank-value');
    expect(node.props.accessible).toBe(true);
    expect(node.props.accessibilityRole).toBe('adjustable');
    expect(node.props.accessibilityLabel).toBe('Tank level');
    expect(node.props.accessibilityValue).toEqual({ text: '100 L' });
    expect(node.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    expect(view.getAllByRole('adjustable')).toHaveLength(1);
  });

  it('disables plus at the upper bound and minus at the lower one', () => {
    const top = setup(100);
    expect(top.view.getByTestId('tank-plus').props.accessibilityState.disabled).toBe(true);
    expect(top.view.getByTestId('tank-minus').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(top.view.getByTestId('tank-plus'));
    top.act('increment');
    expect(top.onChange).not.toHaveBeenCalled();
    top.view.unmount();

    const bottom = setup(10);
    expect(bottom.view.getByTestId('tank-minus').props.accessibilityState.disabled).toBe(true);
    expect(bottom.view.getByTestId('tank-plus').props.accessibilityState.disabled).toBe(false);
    bottom.act('decrement');
    expect(bottom.onChange).not.toHaveBeenCalled();
  });

  it('steps by one step from a value on the grid, by press and by action', () => {
    const { view, onChange, act } = setup(50);
    fireEvent.press(view.getByTestId('tank-plus'));
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.press(view.getByTestId('tank-minus'));
    expect(onChange).toHaveBeenLastCalledWith(45);
    act('increment');
    expect(onChange).toHaveBeenLastCalledWith(55);
    act('decrement');
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it('steps in the displayed unit and writes the stored unit', () => {
    const { view, onChange } = setup(26, HALF_LITRES);
    expect(view.getByTestId('tank-value').props.accessibilityValue).toEqual({ text: '52 L' });
    fireEvent.press(view.getByTestId('tank-plus'));
    expect(onChange).toHaveBeenLastCalledWith(27.5);
    fireEvent.press(view.getByTestId('tank-minus'));
    expect(onChange).toHaveBeenLastCalledWith(25);
  });
});

describe('stepValue', () => {
  const bounds = { min: 10, max: 100 };

  it('snaps a value off the grid to the next step in the direction pressed', () => {
    expect(stepValue(52, 1, { ...bounds, scale: LITRES })).toBe(55);
    expect(stepValue(52, -1, { ...bounds, scale: LITRES })).toBe(50);
  });

  it('clamps in the stored unit rather than overshooting a bound', () => {
    expect(stepValue(98, 1, { ...bounds, scale: LITRES })).toBe(100);
    expect(stepValue(12, -1, { ...bounds, scale: LITRES })).toBe(10);
    expect(stepValue(100, 1, { ...bounds, scale: LITRES })).toBe(100);
    expect(stepValue(10, -1, { ...bounds, scale: LITRES })).toBe(10);
  });

  it('advances one step at a time through a conversion that does not round-trip exactly', () => {
    const scale: StepperScale = { perStored: 3.28084, step: 15 };
    let stored = 45 / scale.perStored;
    for (const expected of [60, 75, 90, 105, 120]) {
      stored = stepValue(stored, 1, { min: 0, max: 1000, scale });
      expect(stored * scale.perStored).toBeCloseTo(expected, 9);
    }
    for (const expected of [105, 90, 75]) {
      stored = stepValue(stored, -1, { min: 0, max: 1000, scale });
      expect(stored * scale.perStored).toBeCloseTo(expected, 9);
    }
  });

  it('keeps a stored value already outside the bounds moving back inside', () => {
    expect(stepValue(120, -1, { ...bounds, scale: LITRES })).toBe(100);
    expect(stepValue(4, 1, { ...bounds, scale: LITRES })).toBe(10);
  });
});
